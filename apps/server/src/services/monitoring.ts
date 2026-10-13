import { sql, type RawBuilder } from "kysely";
import { z } from "zod";
import type { DB } from "@db/index.js";
import type { JsonObject } from "@smartdoca/plugin-contracts";
import type {
  MonitoringServiceV1,
  TelemetryServiceV1,
  MonitoringCallOptions,
  MonitoringCoverage,
  MonitoringLog,
  MonitoringLogs,
  MonitoringPageQuery,
  MonitoringAIUsage,
  MonitoringAIUsageQuery,
  MonitoringAuditQuery,
} from "@smartdoca/plugin-sdk/monitoring";
import type { PluginRequestContext } from "@smartdoca/plugin-sdk/platform";
import { fail } from "@core/shared/errors.js";
import { cursorFingerprint } from "@core/shared/cursor.js";
import { HOST_VERSION } from "../app/version.js";
import { monitoringInputs } from "./monitoring-validation.js";
import {
  MonitoringBuffer,
  redactMonitoringFields,
  redactMonitoringText,
  summarizeHttp,
} from "./monitoring-buffer.js";
import {
  createMonitoringCluster,
  type MonitoringCluster,
} from "./monitoring-cluster.js";
import type { RealtimeCluster } from "./realtime/cluster.js";

function check(options?: MonitoringCallOptions) {
  options?.signal?.throwIfAborted();
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail(400, "Invalid monitoring query");
  return result.data;
}
function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function decode(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString());
  } catch {
    fail(400, "Invalid monitoring cursor");
  }
}
/** Merge heads by wall clock while preserving each epoch's sequence when the clock moves backwards. */
function* mergeLogs(streams: readonly (readonly MonitoringLog[])[]) {
  type Head = { items: readonly MonitoringLog[]; index: number };
  const heap: Head[] = [];
  const earlier = (a: Head, b: Head) => {
    const left = a.items[a.index]!,
      right = b.items[b.index]!;
    return (
      left.createdAt < right.createdAt ||
      (left.createdAt === right.createdAt && left.epoch < right.epoch)
    );
  };
  for (const items of streams)
    if (items.length) {
      heap.push({ items, index: 0 });
      let index = heap.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!earlier(heap[index]!, heap[parent]!)) break;
        [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
        index = parent;
      }
    }
  while (heap.length) {
    const head = heap[0]!;
    yield head.items[head.index]!;
    head.index++;
    if (head.index >= head.items.length) {
      const last = heap.pop()!;
      if (!heap.length) return;
      heap[0] = last;
    }
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && earlier(heap[child + 1]!, heap[child]!))
        child++;
      if (!earlier(heap[child]!, heap[index]!)) break;
      [heap[index], heap[child]] = [heap[child]!, heap[index]!];
      index = child;
    }
  }
}
const pageCursor = z
  .object({
    version: z.literal(1),
    fingerprint: z.string(),
    time: z.string().datetime(),
    id: z.string().min(1).max(200),
    until: z.string().datetime(),
  })
  .strict();
const logCursor = z
  .object({
    version: z.literal(1),
    fingerprint: z.string(),
    positions: z.record(
      z.string().uuid(),
      z
        .object({
          instanceId: z.string().max(200),
          sequence: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine((value) => Object.keys(value.positions).length <= 128);

async function pageRows<T extends { id: string; created_at: string }>(
  db: DB,
  table: string,
  selection: RawBuilder<unknown>,
  filters: readonly { column: string; value: string }[],
  input: MonitoringPageQuery,
  fingerprint: string,
  options?: MonitoringCallOptions,
) {
  const cursor = input.cursor ? parse(pageCursor, decode(input.cursor)) : null;
  if (cursor && cursor.fingerprint !== fingerprint)
    fail(400, "Monitoring cursor does not match the query");
  const until = cursor?.until ?? input.until ?? new Date().toISOString();
  const predicates: RawBuilder<unknown>[] = [
    sql`${sql.ref("created_at")} <= ${until}`,
  ];
  if (input.since) {
    if (input.since > until) fail(400, "Invalid monitoring time range");
    predicates.push(sql`${sql.ref("created_at")} >= ${input.since}`);
  }
  for (const filter of filters)
    predicates.push(sql`${sql.ref(filter.column)} = ${filter.value}`);
  if (cursor)
    predicates.push(
      sql`(created_at > ${cursor.time} or (created_at = ${cursor.time} and id > ${cursor.id}))`,
    );
  const limit = input.limit ?? 100;
  const { rows } =
    await sql<T>`select ${selection} from ${sql.table(table)} where ${sql.join(predicates, sql` and `)} order by created_at asc, id asc limit ${limit + 1}`.execute(
      db,
    );
  check(options);
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encode({
            version: 1,
            fingerprint,
            time: last.created_at,
            id: last.id,
            until,
          })
        : null,
  };
}
function usageProjection(row: {
  id: string;
  user_id: string;
  model_id: string;
  job_id: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  usage: string;
}): MonitoringAIUsage {
  const base = {
    callId: row.id,
    userId: row.user_id,
    modelId: row.model_id,
    jobId: row.job_id,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const unknown = {
    ...base,
    usageStatus: "unknown" as const,
    ratedTokens: null,
    providerMetrics: null,
  };
  if (!row.usage) return unknown;
  try {
    const value = JSON.parse(row.usage);
    if (value.known !== true) return unknown;
    const numeric = z.number().finite().nonnegative();
    const rated = z.object({
      input: numeric,
      output: numeric,
      cached: numeric,
      image: numeric,
      total: numeric,
    });
    const metrics = rated.safeParse(value.metrics),
      provider = z
        .record(z.string(), numeric.nullable())
        .safeParse(value.providerMetrics);
    // Older ledger representations stay readable through their original interfaces, never through invented monitoring facts.
    if (!metrics.success || !provider.success)
      return {
        ...base,
        usageStatus: "invalid",
        ratedTokens: null,
        providerMetrics: null,
      };
    return {
      ...base,
      usageStatus: "confirmed",
      ratedTokens: metrics.data,
      providerMetrics: provider.data,
    };
  } catch {
    return {
      ...base,
      usageStatus: "invalid",
      ratedTokens: null,
      providerMetrics: null,
    };
  }
}
export interface HostMonitoring {
  readonly buffer: MonitoringBuffer;
  readonly cluster: MonitoringCluster;
  readonly service: MonitoringServiceV1;
  readonly telemetry: TelemetryServiceV1;
  authorizeBrowser(
    pluginId: string,
    context: PluginRequestContext,
  ): Promise<void>;
  close(): Promise<void>;
}
const collectors = new WeakMap<object, MonitoringBuffer>();
/** Scope binder uses an object-local lookup; no host runtime or private storage is exposed. */
export function monitoringBufferFor(service: object) {
  return collectors.get(service);
}

export async function createHostMonitoring(
  db: DB,
  buffer: MonitoringBuffer,
  realtime: RealtimeCluster,
  options: { redisUrl?: string; prefix?: string },
): Promise<HostMonitoring> {
  const cluster = await createMonitoringCluster(buffer, options);
  const coverage = async (
    scope: "instance" | "cluster",
    call?: MonitoringCallOptions,
  ) => {
    check(call);
    const result = await cluster.read(scope);
    check(call);
    const details: MonitoringCoverage = {
      scope: result.scope,
      sampledAt: new Date(buffer.now()).toISOString(),
      complete:
        !result.unavailable.length &&
        !result.snapshots.some((snapshot) => snapshot.instance.stale),
      instances: result.snapshots.map((snapshot) => snapshot.instance),
      unavailable: result.unavailable,
    };
    return { ...result, details };
  };
  const sampledAt = () => new Date(buffer.now()).toISOString();
  const service: MonitoringServiceV1 = {
    async stats(input, call) {
      check(call);
      parse(monitoringInputs.stats, input);
      const [resources, users, files, objects] = await Promise.all([
        db
          .selectFrom("resources")
          .select("kind")
          .select((eb) => eb.fn.countAll().as("count"))
          .where("deleted_at", "is", null)
          .groupBy("kind")
          .execute(),
        db
          .selectFrom("users")
          .select("status")
          .select((eb) => eb.fn.countAll().as("count"))
          .groupBy("status")
          .execute(),
        db
          .selectFrom("file_items")
          .select((eb) => [
            eb.fn.countAll().as("count"),
            eb.fn.sum("size").as("bytes"),
          ])
          .where("deleted_at", "is", null)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom("file_storage_objects")
          .select((eb) => [
            eb.fn.countAll().as("count"),
            eb.fn.sum("size").as("bytes"),
          ])
          .executeTakeFirstOrThrow(),
      ]);
      check(call);
      return {
        sampledAt: sampledAt(),
        scope: "shared-database",
        documents: Number(
          resources.find((row) => row.kind === "document")?.count ?? 0,
        ),
        libraries: Number(
          resources.find((row) => row.kind === "library")?.count ?? 0,
        ),
        users: users.reduce((sum, row) => sum + Number(row.count), 0),
        activeUsers: Number(
          users.find((row) => row.status === "active")?.count ?? 0,
        ),
        files: Number(files.count),
        fileBytes: Number(files.bytes ?? 0),
        storedObjects: Number(objects.count),
        storedObjectBytes: Number(objects.bytes ?? 0),
      };
    },
    async online(input, call) {
      check(call);
      const query = parse(monitoringInputs.online, input);
      if (!realtime.isReady()) fail(503, "Realtime presence is unavailable");
      const connections = await realtime.connections();
      check(call);
      const people = new Map<
          string,
          { userId: string; connections: number; documents: Set<string> }
        >(),
        documents = new Set<string>();
      for (const connection of connections) {
        let user = people.get(connection.userId);
        if (!user) {
          user = {
            userId: connection.userId,
            connections: 0,
            documents: new Set(),
          };
          people.set(user.userId, user);
        }
        user.connections++;
        if (connection.room) {
          user.documents.add(connection.room);
          documents.add(connection.room);
        }
      }
      const items = [...people.values()]
        .sort((a, b) =>
          a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
        )
        .slice(query.offset, query.offset + query.limit);
      return {
        sampledAt: sampledAt(),
        scope: realtime.mode === "redis" ? "cluster" : "instance",
        source: "realtime-connections",
        uniqueUsers: people.size,
        connections: connections.length,
        activeDocuments: documents.size,
        users: items.map(({ documents, ...user }) => ({
          ...user,
          documentIds: [...documents].sort(),
        })),
        nextOffset:
          query.offset + query.limit < people.size
            ? query.offset + query.limit
            : null,
      };
    },
    async metrics(input, call) {
      const query = parse(monitoringInputs.metrics, input),
        state = await coverage(query.scope, call);
      const active = state.snapshots.filter(
        (snapshot) => !snapshot.instance.stale,
      );
      return {
        ...state.details,
        windowSeconds: query.windowSeconds,
        ...summarizeHttp(active, query.windowSeconds, buffer.now()),
        series: active.flatMap((snapshot) => snapshot.series),
      };
    },
    async logs(input, call) {
      const query = parse(monitoringInputs.logs, input),
        state = await coverage(query.scope, call);
      const { cursor: ignored, limit: pageLimit, ...filters } = query;
      const fingerprint = cursorFingerprint({
        kind: "monitoring.logs.v1",
        ...filters,
      });
      const cursor = query.cursor
        ? parse(logCursor, decode(query.cursor))
        : null;
      if (cursor && cursor.fingerprint !== fingerprint)
        fail(400, "Monitoring cursor does not match the query");
      const positions = Object.assign(
        Object.create(null),
        cursor?.positions ?? {},
      ) as Record<string, { instanceId: string; sequence: number }>;
      const gaps: MonitoringLogs["gaps"][number][] = [],
        candidates: MonitoringLog[][] = [];
      const epochs = new Set(
        state.snapshots.map((snapshot) => snapshot.instance.epoch),
      );
      for (const [epoch, position] of Object.entries(positions))
        if (!epochs.has(epoch)) {
          gaps.push({
            instanceId: position.instanceId,
            epoch,
            reason: "instance-unavailable",
            dropped: null,
          });
          delete positions[epoch];
        }
      for (const snapshot of state.snapshots) {
        const instance = snapshot.instance,
          after = positions[instance.epoch]?.sequence ?? 0;
        if (after > instance.logs.newestSequence)
          fail(400, "Monitoring cursor is ahead of the instance");
        if (after < instance.logs.oldestSequence - 1)
          gaps.push({
            instanceId: instance.instanceId,
            epoch: instance.epoch,
            reason: "evicted",
            dropped: instance.logs.oldestSequence - 1 - after,
          });
        positions[instance.epoch] = {
          instanceId: instance.instanceId,
          sequence: Math.max(after, instance.logs.oldestSequence - 1),
        };
        candidates.push(snapshot.logs.filter((log) => log.sequence > after));
      }
      const items: MonitoringLog[] = [];
      let consumed = 0;
      for (const log of mergeLogs(candidates)) {
        if (items.length >= query.limit) break;
        consumed++;
        positions[log.epoch] = {
          instanceId: log.instanceId,
          sequence: log.sequence,
        };
        if (
          (query.level && log.level !== query.level) ||
          (query.pluginId && log.pluginId !== query.pluginId) ||
          (query.module && log.module !== query.module) ||
          (query.requestId && log.requestId !== query.requestId) ||
          (query.since && log.createdAt < query.since)
        )
          continue;
        items.push(log);
      }
      return {
        ...state.details,
        items,
        cursor: encode({ version: 1, fingerprint, positions }),
        hasMore:
          consumed <
          candidates.reduce((total, items) => total + items.length, 0),
        gaps,
      };
    },
    async audit(input, call) {
      check(call);
      const query = parse(monitoringInputs.audit, input);
      if (
        (query.source === "security" && query.resourceId) ||
        (query.source === "resource" && query.userId)
      )
        fail(400, "Audit filter is unavailable for this source");
      const { cursor, limit, ...filter } = query;
      const filters = [
        { column: "action", value: query.action },
        { column: "actor_id", value: query.actorId },
        { column: "user_id", value: query.userId },
        { column: "resource_id", value: query.resourceId },
      ].filter(
        (value): value is { column: string; value: string } =>
          value.value !== undefined,
      );
      const page = await pageRows<{
        id: string;
        created_at: string;
        action: string;
        actor_id: string | null;
        user_id?: string | null;
        resource_id?: string | null;
        details?: string;
      }>(
        db,
        query.source === "security" ? "security_audit" : "audit_events",
        query.source === "security"
          ? sql`id, created_at, action, actor_id, user_id, details`
          : sql`id, created_at, action, actor_id, resource_id`,
        filters,
        query,
        cursorFingerprint(filter),
        call,
      );
      return {
        sampledAt: sampledAt(),
        nextCursor: page.nextCursor,
        items: page.items.map((row) => {
          let details: JsonObject | null = null,
            detailsValid = true;
          if (query.source === "security") {
            try {
              const value = JSON.parse(row.details!);
              if (!value || typeof value !== "object" || Array.isArray(value))
                detailsValid = false;
              else details = redactMonitoringFields(value) as JsonObject;
            } catch {
              detailsValid = false;
            }
          }
          return {
            id: row.id,
            createdAt: row.created_at,
            source: query.source,
            action: row.action,
            actorId: row.actor_id,
            userId: query.source === "security" ? row.user_id! : null,
            resourceId: query.source === "resource" ? row.resource_id! : null,
            details,
            detailsValid,
          };
        }),
      };
    },
    async jobs(input, call) {
      check(call);
      parse(monitoringInputs.jobs, input);
      const now = sampledAt();
      const [ai, projection, extracts, aiExpired, projectionExpired, garbage] =
        await Promise.all([
          db
            .selectFrom("ai_jobs")
            .select("status")
            .select((eb) => eb.fn.countAll().as("count"))
            .groupBy("status")
            .execute(),
          db
            .selectFrom("projection_jobs")
            .select(["kind", "status"])
            .select((eb) => eb.fn.countAll().as("count"))
            .groupBy(["kind", "status"])
            .execute(),
          db
            .selectFrom("file_extracts")
            .select("status")
            .select((eb) => eb.fn.countAll().as("count"))
            .groupBy("status")
            .execute(),
          db
            .selectFrom("ai_jobs")
            .select((eb) => eb.fn.countAll().as("count"))
            .where("status", "=", "running")
            .where("lease_until", "<=", now)
            .executeTakeFirstOrThrow(),
          db
            .selectFrom("projection_jobs")
            .select((eb) => eb.fn.countAll().as("count"))
            .where("lease_token", "is not", null)
            .where("lease_until", "<=", now)
            .executeTakeFirstOrThrow(),
          db
            .selectFrom("plugin_object_garbage")
            .select((eb) => eb.fn.countAll().as("count"))
            .executeTakeFirstOrThrow(),
        ]);
      check(call);
      return {
        sampledAt: now,
        scope: "shared-database",
        groups: [
          ...ai.map((row) => ({
            source: "ai" as const,
            kind: "assistant",
            status: row.status,
            count: Number(row.count),
          })),
          ...projection.map((row) => ({
            source: "projection" as const,
            kind: row.kind,
            status: row.status!,
            count: Number(row.count),
          })),
          ...extracts.map((row) => ({
            source: "file-extract" as const,
            kind: "extract",
            status: row.status,
            count: Number(row.count),
          })),
        ],
        expiredLeases: {
          ai: Number(aiExpired.count),
          projection: Number(projectionExpired.count),
        },
        privateObjectsPendingDeletion: Number(garbage.count),
      };
    },
    async jobErrors(input, call) {
      check(call);
      const query = parse(monitoringInputs.jobErrors, input);
      if (query.source === "ai") {
        const rows = await db
          .selectFrom("ai_jobs")
          .select(["id", "status", "attempts", "error", "updated_at"])
          .where("error", "!=", "")
          .orderBy("updated_at", "desc")
          .orderBy("id", "desc")
          .limit(query.limit)
          .execute();
        check(call);
        return {
          sampledAt: sampledAt(),
          nextCursor: null,
          items: rows.map((row) => ({
            id: row.id,
            source: "ai" as const,
            kind: "assistant",
            status: row.status,
            attempts: row.attempts,
            error: redactMonitoringText(row.error),
            updatedAt: row.updated_at,
          })),
        };
      }
      if (query.source === "projection") {
        const rows = await db
          .selectFrom("projection_jobs")
          .select([
            "id",
            "kind",
            "status",
            "attempts",
            "last_error",
            "available_at",
          ])
          .where("last_error", "is not", null)
          .orderBy("available_at", "desc")
          .orderBy("id", "desc")
          .limit(query.limit)
          .execute();
        check(call);
        return {
          sampledAt: sampledAt(),
          nextCursor: null,
          items: rows.map((row) => ({
            id: row.id,
            source: "projection" as const,
            kind: row.kind,
            status: row.status!,
            attempts: row.attempts,
            error: redactMonitoringText(row.last_error!),
            updatedAt: null,
          })),
        };
      }
      const rows = await db
        .selectFrom("file_extracts")
        .select(["storage_object_id", "status", "error", "updated_at"])
        .where("error", "is not", null)
        .orderBy("updated_at", "desc")
        .orderBy("storage_object_id", "desc")
        .limit(query.limit)
        .execute();
      check(call);
      return {
        sampledAt: sampledAt(),
        nextCursor: null,
        items: rows.map((row) => ({
          id: row.storage_object_id,
          source: "file-extract" as const,
          kind: "extract",
          status: row.status,
          attempts: null,
          error: redactMonitoringText(row.error!),
          updatedAt: row.updated_at,
        })),
      };
    },
    async aiUsage(input, call) {
      check(call);
      const query = parse(monitoringInputs.aiUsage, input);
      const { cursor, limit, ...filter } = query;
      const filters = [
        { column: "user_id", value: query.userId },
        { column: "model_id", value: query.modelId },
        { column: "state", value: query.state },
      ].filter(
        (value): value is { column: string; value: string } =>
          value.value !== undefined,
      );
      const page = await pageRows<Parameters<typeof usageProjection>[0]>(
        db,
        "ai_calls",
        sql`id, user_id, model_id, job_id, state, created_at, updated_at, usage`,
        filters,
        query,
        cursorFingerprint({ kind: "monitoring.ai-usage.v1", ...filter }),
        call,
      );
      return {
        sampledAt: sampledAt(),
        nextCursor: page.nextCursor,
        items: page.items.map(usageProjection),
      };
    },
    async health(input, call) {
      check(call);
      const query = parse(monitoringInputs.health, input);
      const started = performance.now();
      let database = true;
      try {
        await db
          .selectFrom("settings")
          .select("id")
          .where("id", "=", "system")
          .executeTakeFirstOrThrow();
      } catch {
        database = false;
      }
      const databaseLatencyMs = performance.now() - started;
      check(call);
      let details: MonitoringCoverage;
      try {
        details = (await coverage(query.scope, call)).details;
      } catch (error) {
        check(call);
        details = {
          scope: query.scope,
          sampledAt: sampledAt(),
          complete: false,
          instances: [buffer.snapshot().instance],
          unavailable: ["monitoring-cluster"],
        };
      }
      return {
        ...details,
        hostVersion: HOST_VERSION,
        dependencies: [
          {
            name: "database",
            status: database ? "ok" : "unavailable",
            latencyMs: databaseLatencyMs,
          },
          {
            name: "realtime",
            status: realtime.isReady() ? "ok" : "unavailable",
            latencyMs: null,
          },
          {
            name: "monitoring-cache",
            status: cluster.isReady() ? "ok" : "unavailable",
            latencyMs: null,
          },
          { name: "file-storage", status: "not-probed", latencyMs: null },
          { name: "search-provider", status: "not-probed", latencyMs: null },
          { name: "ai-provider", status: "not-probed", latencyMs: null },
        ],
      };
    },
  };
  const telemetry: TelemetryServiceV1 = {
    log: (pluginId, input) => buffer.log(pluginId, input),
    record: (pluginId, input) => buffer.record(pluginId, input),
  };
  collectors.set(service, buffer);
  collectors.set(telemetry, buffer);
  return {
    service,
    telemetry,
    buffer,
    cluster,
    async authorizeBrowser(pluginId, context) {
      check({ signal: context.signal });
      if (buffer.closed || !buffer.readers.has(pluginId))
        fail(403, "Plugin has no active monitoring service declaration");
      const user = await db
        .selectFrom("users")
        .select(["status", "admin"])
        .where("id", "=", context.principal.id)
        .executeTakeFirst();
      check({ signal: context.signal });
      if (!user || user.status !== "active" || !user.admin)
        fail(403, "Monitoring requires an active administrator");
    },
    close: () => cluster.close(),
  };
}
