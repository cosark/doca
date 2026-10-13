import { createClient, type RedisClientType } from "redis";
import { z } from "zod";
import { fail } from "@core/shared/errors.js";
import type {
  MonitoringBuffer,
  MonitoringSnapshot,
} from "./monitoring-buffer.js";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite();
const histogram = z
  .object({
    count: integer,
    sum: finite,
    min: finite,
    max: finite,
    buckets: z.array(integer).length(13),
  })
  .strict();
const route = z
  .object({
    method: z.string().max(20),
    route: z.string().max(500),
    requests: integer,
    clientErrors: integer,
    serverErrors: integer,
    latency: histogram,
  })
  .strict();
const snapshotSchema = z
  .object({
    version: z.literal(1),
    instance: z
      .object({
        instanceId: z.string().min(1).max(200),
        epoch: z.string().uuid(),
        startedAt: z.string().datetime(),
        sampledAt: z.string().datetime(),
        stale: z.boolean(),
        uptimeSeconds: finite.nonnegative(),
        process: z
          .object({
            rssBytes: integer,
            heapUsedBytes: integer,
            cpuUserMicros: integer,
            cpuSystemMicros: integer,
            eventLoopDelayP95Ms: finite.nullable(),
          })
          .strict(),
        logs: z
          .object({
            oldestSequence: integer,
            newestSequence: integer,
            dropped: integer,
            retained: integer,
          })
          .strict(),
        rejectedMetricSeries: integer,
      })
      .strict(),
    http: z
      .array(
        z
          .object({
            second: integer,
            requests: integer,
            clientErrors: integer,
            serverErrors: integer,
            aborted: integer,
            latency: histogram,
            routes: z.array(route).max(100),
          })
          .strict(),
      )
      .max(301),
    inFlight: integer,
    series: z
      .array(
        z
          .object({
            instanceId: z.string(),
            epoch: z.string().uuid(),
            pluginId: z.string(),
            name: z.string().max(200),
            kind: z.enum(["counter", "gauge", "histogram"]),
            labels: z.record(z.string(), z.string()),
            updatedAt: z.string().datetime(),
            value: finite.nullable(),
            histogram: z
              .object({
                count: integer,
                sum: finite,
                min: finite.nullable(),
                max: finite.nullable(),
                buckets: z
                  .array(
                    z
                      .object({ upperBound: finite.nullable(), count: integer })
                      .strict(),
                  )
                  .length(13),
                p50: finite.nullable(),
                p95: finite.nullable(),
                p99: finite.nullable(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(1000),
    logs: z
      .array(
        z
          .object({
            id: z.string(),
            sequence: integer,
            instanceId: z.string(),
            epoch: z.string().uuid(),
            createdAt: z.string().datetime(),
            pluginId: z.string().nullable(),
            level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
            module: z.string().max(200),
            message: z.string().max(2000),
            requestId: z.string().nullable(),
            fields: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
const snapshotLimit = 16 * 1024 * 1024;
export const monitoringStaleMs = 15000;
export const monitoringRetentionMs = 60 * 60 * 1000;

/** Versioned ephemeral host cache, separate from the durable database and realtime protocol. */
export class MonitoringCluster {
  readonly #redis: RedisClientType | undefined;
  readonly #registry: string;
  #timer: ReturnType<typeof setInterval> | undefined;
  #publishing: Promise<void> | undefined;
  #closed = false;
  constructor(
    readonly buffer: MonitoringBuffer,
    options: { redis?: RedisClientType; prefix?: string } = {},
  ) {
    this.#redis = options.redis;
    this.#registry =
      (options.prefix?.trim() || "doca") + ":monitoring:v1:instances";
  }
  get mode() {
    return this.#redis ? ("redis" as const) : ("local" as const);
  }
  isReady() {
    return !this.#closed && (!this.#redis || this.#redis.isReady);
  }
  async start() {
    await this.publish();
    this.#timer = setInterval(() => {
      void this.publish().catch(() => {});
    }, 5000);
    this.#timer.unref();
  }
  async publish() {
    if (!this.#redis || this.#closed) return;
    if (this.#publishing) return this.#publishing;
    this.#publishing = (async () => {
      if (!this.#redis!.isReady) fail(503, "Monitoring Redis is unavailable");
      const snapshot = this.buffer.snapshot(),
        raw = JSON.stringify(snapshot),
        now = this.buffer.now();
      if (Buffer.byteLength(raw) > snapshotLimit)
        fail(503, "Monitoring snapshot exceeds the cluster limit");
      await this.#redis!.multi()
        .set(this.#registry + ":" + snapshot.instance.epoch, raw, {
          PX: monitoringRetentionMs,
        })
        .zAdd(this.#registry, { score: now, value: snapshot.instance.epoch })
        .zRemRangeByScore(this.#registry, 0, now - monitoringRetentionMs)
        .pExpire(this.#registry, monitoringRetentionMs)
        .exec();
    })().finally(() => {
      this.#publishing = undefined;
    });
    return this.#publishing;
  }
  async read(scope: "instance" | "cluster") {
    if (this.#closed) fail(503, "Monitoring collector is closed");
    if (scope === "instance" || !this.#redis)
      return {
        scope: "instance" as const,
        snapshots: [this.buffer.snapshot()],
        unavailable: [] as string[],
      };
    if (!this.#redis.isReady) fail(503, "Monitoring Redis is unavailable");
    await this.publish();
    const epochs = await this.#redis.zRangeByScore(
      this.#registry,
      this.buffer.now() - monitoringRetentionMs,
      "+inf",
    );
    if (epochs.length > 128)
      fail(
        503,
        "Monitoring cluster exceeds 128 instances; query individual instances",
      );
    if (!epochs.length)
      fail(503, "Monitoring cluster inventory is unavailable");
    const raw = await this.#redis.mGet(
      epochs.map((epoch) => this.#registry + ":" + epoch),
    );
    const snapshots: MonitoringSnapshot[] = [],
      unavailable: string[] = [];
    raw.forEach((value, index) => {
      try {
        if (!value || Buffer.byteLength(value) > snapshotLimit) throw Error();
        const snapshot = snapshotSchema.parse(
          JSON.parse(value),
        ) as MonitoringSnapshot;
        if (snapshot.instance.epoch !== epochs[index]) throw Error();
        if (
          snapshot.logs.some(
            (log, index, logs) =>
              log.epoch !== snapshot.instance.epoch ||
              log.instanceId !== snapshot.instance.instanceId ||
              log.sequence < snapshot.instance.logs.oldestSequence ||
              log.sequence > snapshot.instance.logs.newestSequence ||
              (index > 0 && log.sequence !== logs[index - 1]!.sequence + 1),
          )
        )
          throw Error();
        if (
          snapshot.logs.length !== snapshot.instance.logs.retained ||
          snapshot.series.some(
            (series) =>
              series.epoch !== snapshot.instance.epoch ||
              series.instanceId !== snapshot.instance.instanceId,
          )
        )
          throw Error();
        if (Date.parse(snapshot.instance.sampledAt) > this.buffer.now() + 5000)
          throw Error();
        snapshot.instance = {
          ...snapshot.instance,
          stale:
            snapshot.instance.stale ||
            this.buffer.now() - Date.parse(snapshot.instance.sampledAt) >
              monitoringStaleMs,
        };
        snapshots.push(snapshot);
      } catch {
        unavailable.push(epochs[index]!);
      }
    });
    return { scope: "cluster" as const, snapshots, unavailable };
  }
  async close() {
    if (this.#closed) return;
    if (this.#timer) clearInterval(this.#timer);
    await this.#publishing?.catch(() => {});
    this.buffer.close();
    await this.publish().catch(() => {});
    this.#closed = true;
    if (this.#redis?.isOpen) {
      if (this.#redis.isReady)
        await this.#redis.quit().catch(() => this.#redis!.destroy());
      else this.#redis.destroy();
    }
  }
}
export async function createMonitoringCluster(
  buffer: MonitoringBuffer,
  options: { redisUrl?: string; prefix?: string },
) {
  let redis: RedisClientType | undefined;
  if (options.redisUrl) {
    redis = createClient({
      url: options.redisUrl,
      disableOfflineQueue: true,
      commandOptions: { timeout: 2000 },
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 2000),
      },
    });
    redis.on("error", () => {});
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        redis.connect(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(Error("Monitoring Redis startup timed out")),
            3000,
          );
        }),
      ]);
    } catch {
      if (redis.isOpen) redis.destroy();
      buffer.close();
      fail(503, "Monitoring Redis connection failed");
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  const cluster = new MonitoringCluster(buffer, {
    redis,
    prefix: options.prefix,
  });
  try {
    await cluster.start();
  } catch (error) {
    await cluster.close();
    throw error;
  }
  return cluster;
}
