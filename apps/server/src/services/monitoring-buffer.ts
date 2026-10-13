import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { JsonObject, JsonValue } from "@smartdoca/plugin-contracts";
import type {
  MonitoringHistogram,
  MonitoringHttpMetrics,
  MonitoringInstance,
  MonitoringLog,
  MonitoringMetricSeries,
  TelemetryLogInput,
  TelemetryMetricInput,
} from "@smartdoca/plugin-sdk/monitoring";
import { fail } from "@core/shared/errors.js";
import {
  telemetryLogInput,
  telemetryMetricInput,
} from "./monitoring-validation.js";

const bounds = [
  1,
  5,
  10,
  25,
  50,
  100,
  250,
  500,
  1000,
  2500,
  5000,
  10000,
  Infinity,
];
export interface Histogram {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
}
export const newHistogram = (): Histogram => ({
  count: 0,
  sum: 0,
  min: 0,
  max: 0,
  buckets: bounds.map(() => 0),
});
function observe(h: Histogram, value: number) {
  h.min = h.count ? Math.min(h.min, value) : value;
  h.max = h.count ? Math.max(h.max, value) : value;
  h.count++;
  h.sum += value;
  h.buckets[bounds.findIndex((bound) => value <= bound)]!++;
}
export function mergeHistogram(target: Histogram, source: Histogram) {
  if (!source.count) return;
  target.min = target.count ? Math.min(target.min, source.min) : source.min;
  target.max = target.count ? Math.max(target.max, source.max) : source.max;
  target.count += source.count;
  target.sum += source.sum;
  source.buckets.forEach((count, index) => (target.buckets[index]! += count));
}
export function projectHistogram(h: Histogram): MonitoringHistogram {
  const quantile = (percent: number) => {
    if (!h.count) return null;
    let count = 0;
    for (let index = 0; index < bounds.length; index++) {
      count += h.buckets[index]!;
      if (count >= Math.ceil(h.count * percent))
        return Math.min(bounds[index]!, h.max);
    }
    return h.max;
  };
  return {
    count: h.count,
    sum: h.sum,
    min: h.count ? h.min : null,
    max: h.count ? h.max : null,
    buckets: bounds.map((bound, index) => ({
      upperBound: Number.isFinite(bound) ? bound : null,
      count: h.buckets[index]!,
    })),
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
  };
}
/** Sanitization applies to both host and plugin logs, audit details and job errors. */
export function redactMonitoringText(value: string) {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, "$1 [redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted]",
    )
    .replace(
      /((?:["']?)(?:api[-_ ]?key|password|passwd|secret|access[-_ ]?token|refresh[-_ ]?token|token|authorization|cookie|credential)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .slice(0, 2000);
}
const hiddenKey =
  /api.?key|^key$|verification.?code|password|passwd|secret|token|authorization|cookie|credential|private.?key|^headers$|^body$|^prompt$|^messages$|^content$|^checkpoint$|^payload$|^raw$|^input$|^result$|^stack$|model.?snapshot/i;
export function redactMonitoringFields(value: unknown, depth = 0): JsonValue {
  if (depth > 4) return "[depth-limit]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string")
    return redactMonitoringText(value).slice(0, 500);
  if (Array.isArray(value))
    return value
      .slice(0, 10)
      .map((item) => redactMonitoringFields(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value).slice(0, 30)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      result[key.slice(0, 100)] = hiddenKey.test(key)
        ? "[redacted]"
        : redactMonitoringFields(member, depth + 1);
    }
    return result;
  }
  return null;
}
interface RouteBucket {
  method: string;
  route: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  latency: Histogram;
}
interface HttpBucket {
  second: number;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  aborted: number;
  latency: Histogram;
  routes: Map<string, RouteBucket>;
}
export interface MonitoringSnapshot {
  version: 1;
  instance: MonitoringInstance;
  http: {
    second: number;
    requests: number;
    clientErrors: number;
    serverErrors: number;
    aborted: number;
    latency: Histogram;
    routes: RouteBucket[];
  }[];
  inFlight: number;
  series: MonitoringMetricSeries[];
  logs: MonitoringLog[];
}
export class MonitoringBuffer {
  readonly epoch = randomUUID();
  readonly startedAt: string;
  readonly readers = new Map<string, number>();
  readonly #histogram = monitorEventLoopDelay({ resolution: 20 });
  readonly #http = new Map<number, HttpBucket>();
  readonly #routes = new Set<string>();
  readonly #series = new Map<
    string,
    {
      input: TelemetryMetricInput;
      pluginId: string;
      value: number;
      histogram: Histogram;
      updatedAt: string;
    }
  >();
  readonly #definitions = new Map<string, { kind: string; keys: string }>();
  readonly #logs = new Map<number, { log: MonitoringLog; bytes: number }>();
  #lastTrimmedSecond = -Infinity;
  #bytes = 0;
  #sequence = 0;
  #dropped = 0;
  #rejected = 0;
  #inFlight = 0;
  #closed = false;
  constructor(
    readonly instanceId: string,
    readonly now: () => number = Date.now,
    readonly logLimit = 2000,
    readonly byteLimit = 2 * 1024 * 1024,
  ) {
    if (!instanceId || instanceId.length > 200 || logLimit < 1 || byteLimit < 1)
      throw new Error("Invalid monitoring buffer limits or instance ID");
    this.startedAt = new Date(now()).toISOString();
    this.#histogram.enable();
  }
  get closed() {
    return this.#closed;
  }
  begin() {
    if (!this.#closed) this.#inFlight++;
  }
  request(
    method: string,
    route: string,
    status: number | null,
    durationMs: number,
  ) {
    if (this.#closed) return;
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    const second = Math.floor(this.now() / 1000);
    this.#trim(second);
    let bucket = this.#http.get(second);
    if (!bucket) {
      bucket = {
        second,
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        aborted: 0,
        latency: newHistogram(),
        routes: new Map(),
      };
      this.#http.set(second, bucket);
    }
    if (status === null) {
      bucket.aborted++;
      return;
    }
    bucket.requests++;
    if (status >= 400 && status < 500) bucket.clientErrors++;
    if (status >= 500) bucket.serverErrors++;
    observe(bucket.latency, durationMs);
    const key = method + " " + route;
    if (!this.#routes.has(key) && this.#routes.size >= 64)
      route = "[other-routes]";
    else this.#routes.add(key);
    const effectiveKey = method + " " + route;
    let row = bucket.routes.get(effectiveKey);
    if (!row) {
      row = {
        method,
        route,
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        latency: newHistogram(),
      };
      bucket.routes.set(effectiveKey, row);
    }
    row.requests++;
    if (status >= 400 && status < 500) row.clientErrors++;
    if (status >= 500) row.serverErrors++;
    observe(row.latency, durationMs);
  }
  log(pluginId: string | null, input: TelemetryLogInput) {
    if (this.#closed) fail(503, "Telemetry collector is closed");
    const parsed = telemetryLogInput.safeParse(input);
    if (!parsed.success) fail(400, "Invalid telemetry log");
    const fields = redactMonitoringFields(
      parsed.data.fields ?? {},
    ) as JsonObject;
    const log: MonitoringLog = {
      id: this.epoch + ":" + ++this.#sequence,
      sequence: this.#sequence,
      epoch: this.epoch,
      instanceId: this.instanceId,
      createdAt: new Date(this.now()).toISOString(),
      pluginId,
      level: parsed.data.level,
      module: redactMonitoringText(parsed.data.module),
      message: redactMonitoringText(parsed.data.message),
      requestId: parsed.data.requestId ?? null,
      fields,
    };
    const bytes = Buffer.byteLength(JSON.stringify(log));
    this.#logs.set(log.sequence, { log, bytes });
    this.#bytes += bytes;
    while (this.#logs.size > this.logLimit || this.#bytes > this.byteLimit) {
      const [sequence, removed] = this.#logs.entries().next().value!;
      this.#logs.delete(sequence);
      this.#bytes -= removed.bytes;
      this.#dropped++;
    }
  }
  hostLog(raw: string) {
    // Logging must never make a host request fail, even for malformed logger output.
    try {
      const row = JSON.parse(raw);
      const levels: Record<number, TelemetryLogInput["level"]> = {
        10: "trace",
        20: "debug",
        30: "info",
        40: "warn",
        50: "error",
        60: "fatal",
      };
      if (!levels[row.level]) return;
      // Per-request success logs are already represented by metrics. Keep host warnings/errors and application logs.
      if (
        ["incoming request", "request completed"].includes(row.msg) &&
        row.level < 40
      )
        return;
      const { msg, level, time, pid, hostname, reqId, ...fields } = row;
      this.log(null, {
        level: levels[level]!,
        module: "host",
        message: String(msg ?? "Host log").slice(0, 2000),
        ...(typeof reqId === "string"
          ? { requestId: reqId.slice(0, 200) }
          : {}),
        fields,
      });
    } catch {
      /* Logger output is best effort; request metrics and durable audit remain separate. */
    }
  }
  record(pluginId: string, input: TelemetryMetricInput) {
    if (this.#closed) fail(503, "Telemetry collector is closed");
    const parsed = telemetryMetricInput.safeParse(input);
    if (!parsed.success) fail(400, "Invalid telemetry metric");
    const value = parsed.data;
    if (
      !value.name.startsWith(pluginId + ".") ||
      Object.keys(value.labels).length > 6 ||
      (value.kind !== "gauge" && value.value < 0)
    )
      fail(400, "Invalid metric namespace, labels or value");
    if (
      Object.entries(value.labels).some(
        ([key, label]) =>
          hiddenKey.test(key) || redactMonitoringText(label) !== label,
      )
    )
      fail(400, "Sensitive metric labels are unavailable");
    const labels = Object.fromEntries(
      Object.entries(value.labels).sort(([a], [b]) => a.localeCompare(b)),
    );
    const keys = JSON.stringify(Object.keys(labels));
    const definition = this.#definitions.get(value.name);
    if (
      definition &&
      (definition.kind !== value.kind || definition.keys !== keys)
    )
      fail(409, "Metric kind or label keys changed");
    const key = value.name + JSON.stringify(labels);
    let series = this.#series.get(key);
    if (
      value.kind === "histogram" &&
      !Number.isFinite((series?.histogram.sum ?? 0) + value.value)
    )
      fail(400, "Histogram overflow");
    if (
      !series &&
      (this.#series.size >= 1000 ||
        [...this.#series.values()].filter((row) => row.pluginId === pluginId)
          .length >= 200)
    ) {
      this.#rejected++;
      fail(429, "Telemetry series limit reached");
    }
    if (!series) {
      series = {
        input: { ...value, labels },
        pluginId,
        value: 0,
        histogram: newHistogram(),
        updatedAt: "",
      };
      this.#series.set(key, series);
      this.#definitions.set(value.name, { kind: value.kind, keys });
    }
    if (value.kind === "histogram") observe(series.histogram, value.value);
    else if (value.kind === "gauge") series.value = value.value;
    else {
      if (!Number.isFinite(series.value + value.value))
        fail(400, "Counter overflow");
      series.value += value.value;
    }
    series.updatedAt = new Date(this.now()).toISOString();
  }
  #trim(second: number) {
    if (second === this.#lastTrimmedSecond) return;
    this.#lastTrimmedSecond = second;
    for (const key of this.#http.keys())
      if (key < second - 300) this.#http.delete(key);
  }
  snapshot(): MonitoringSnapshot {
    const now = this.now();
    this.#trim(Math.floor(now / 1000));
    const memory = process.memoryUsage(),
      cpu = process.cpuUsage();
    const instance: MonitoringInstance = {
      instanceId: this.instanceId,
      epoch: this.epoch,
      startedAt: this.startedAt,
      sampledAt: new Date(now).toISOString(),
      stale: this.#closed,
      uptimeSeconds: Math.max(0, (now - Date.parse(this.startedAt)) / 1000),
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        eventLoopDelayP95Ms: this.#histogram.count
          ? this.#histogram.percentile(95) / 1e6
          : null,
      },
      logs: {
        oldestSequence:
          this.#logs.values().next().value?.log.sequence ?? this.#sequence + 1,
        newestSequence: this.#sequence,
        dropped: this.#dropped,
        retained: this.#logs.size,
      },
      rejectedMetricSeries: this.#rejected,
    };
    return {
      version: 1,
      instance,
      inFlight: this.#inFlight,
      http: [...this.#http.values()].map((bucket) => ({
        ...bucket,
        latency: { ...bucket.latency, buckets: [...bucket.latency.buckets] },
        routes: [...bucket.routes.values()].map((route) => ({
          ...route,
          latency: { ...route.latency, buckets: [...route.latency.buckets] },
        })),
      })),
      series: [...this.#series.values()].map((row) => ({
        instanceId: this.instanceId,
        epoch: this.epoch,
        pluginId: row.pluginId,
        name: row.input.name,
        kind: row.input.kind,
        labels: { ...row.input.labels! },
        updatedAt: row.updatedAt,
        value: row.input.kind === "histogram" ? null : row.value,
        histogram:
          row.input.kind === "histogram"
            ? projectHistogram(row.histogram)
            : null,
      })),
      logs: [...this.#logs.values()].map(({ log }) => structuredClone(log)),
    };
  }
  close() {
    this.#closed = true;
    this.readers.clear();
    this.#histogram.disable();
  }
}
export function summarizeHttp(
  snapshots: readonly MonitoringSnapshot[],
  windowSeconds: number,
  now = Date.now(),
) {
  const histogram = newHistogram(),
    routes = new Map<string, RouteBucket>();
  const http: {
    -readonly [Key in keyof Omit<MonitoringHttpMetrics, "latencyMs">]: Omit<
      MonitoringHttpMetrics,
      "latencyMs"
    >[Key];
  } = {
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    aborted: 0,
    inFlight: 0,
    qps: 0,
    errorRate: null,
  };
  const earliest = Math.floor(now / 1000) - windowSeconds + 1;
  for (const snapshot of snapshots) {
    let count = 0;
    const end = Math.floor(Date.parse(snapshot.instance.sampledAt) / 1000);
    for (const bucket of snapshot.http) {
      if (bucket.second < earliest || bucket.second > end) continue;
      count += bucket.requests;
      http.requests += bucket.requests;
      http.clientErrors += bucket.clientErrors;
      http.serverErrors += bucket.serverErrors;
      http.aborted += bucket.aborted;
      mergeHistogram(histogram, bucket.latency);
      for (const route of bucket.routes) {
        const key = route.method + " " + route.route;
        let target = routes.get(key);
        if (!target) {
          target = {
            method: route.method,
            route: route.route,
            requests: 0,
            clientErrors: 0,
            serverErrors: 0,
            latency: newHistogram(),
          };
          routes.set(key, target);
        }
        target.requests += route.requests;
        target.clientErrors += route.clientErrors;
        target.serverErrors += route.serverErrors;
        mergeHistogram(target.latency, route.latency);
      }
    }
    const covered = Math.max(
      0.001,
      Math.min(
        windowSeconds,
        (Date.parse(snapshot.instance.sampledAt) -
          Math.max(earliest * 1000, Date.parse(snapshot.instance.startedAt))) /
          1000,
      ),
    );
    http.qps += count / covered;
    http.inFlight += snapshot.inFlight;
  }
  http.errorRate = http.requests ? http.serverErrors / http.requests : null;
  return {
    http: { ...http, latencyMs: projectHistogram(histogram) },
    routes: [...routes.values()].map(({ latency, ...route }) => ({
      ...route,
      latencyMs: projectHistogram(latency),
    })),
  };
}
