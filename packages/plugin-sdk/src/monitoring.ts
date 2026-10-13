import { defineService } from "./index.js";
import type { JsonObject } from "@smartdoca/plugin-contracts";

export interface MonitoringCallOptions {
  readonly signal?: AbortSignal;
}
export type MonitoringScope = "instance" | "cluster";
export type TelemetryLevel =
  "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type TelemetryMetricKind = "counter" | "gauge" | "histogram";
export interface TelemetryLogInput {
  readonly level: TelemetryLevel;
  readonly module: string;
  readonly message: string;
  readonly requestId?: string;
  readonly fields?: JsonObject;
}
export interface TelemetryMetricInput {
  /** Starts with the owning plugin ID and a dot. Label sets are bounded by the host. */
  readonly name: string;
  readonly kind: TelemetryMetricKind;
  readonly value: number;
  readonly labels?: Readonly<Record<string, string>>;
}
export interface TelemetryServiceV1 {
  log(pluginId: string, input: TelemetryLogInput): void;
  record(pluginId: string, input: TelemetryMetricInput): void;
}
export interface MonitoringInstance {
  readonly instanceId: string;
  /** Changes on every process start, including reuse of an instanceId. */
  readonly epoch: string;
  readonly startedAt: string;
  readonly sampledAt: string;
  readonly stale: boolean;
  readonly uptimeSeconds: number;
  readonly process: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly cpuUserMicros: number;
    readonly cpuSystemMicros: number;
    readonly eventLoopDelayP95Ms: number | null;
  };
  readonly logs: {
    readonly oldestSequence: number;
    readonly newestSequence: number;
    readonly dropped: number;
    readonly retained: number;
  };
  readonly rejectedMetricSeries: number;
}
export interface MonitoringCoverage {
  readonly scope: MonitoringScope;
  readonly sampledAt: string;
  readonly complete: boolean;
  readonly instances: readonly MonitoringInstance[];
  readonly unavailable: readonly string[];
}
export interface MonitoringHistogram {
  readonly count: number;
  readonly sum: number;
  readonly min: number | null;
  readonly max: number | null;
  /** Exclusive buckets; null is the final unbounded bucket. Quantiles use bucket upper bounds. */
  readonly buckets: readonly {
    readonly upperBound: number | null;
    readonly count: number;
  }[];
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}
export interface MonitoringHttpMetrics {
  readonly requests: number;
  readonly clientErrors: number;
  readonly serverErrors: number;
  readonly aborted: number;
  readonly inFlight: number;
  readonly qps: number;
  /** 5xx / completed responses; null when no responses were completed. */
  readonly errorRate: number | null;
  readonly latencyMs: MonitoringHistogram;
}
export interface MonitoringMetricSeries {
  readonly instanceId: string;
  readonly epoch: string;
  readonly pluginId: string;
  readonly name: string;
  readonly kind: TelemetryMetricKind;
  readonly labels: Readonly<Record<string, string>>;
  readonly updatedAt: string;
  /** Counter/gauge value since this epoch began. Histograms have a null scalar value. */
  readonly value: number | null;
  readonly histogram: MonitoringHistogram | null;
}
export interface MonitoringMetrics extends MonitoringCoverage {
  readonly windowSeconds: number;
  readonly http: MonitoringHttpMetrics;
  readonly routes: readonly {
    readonly method: string;
    readonly route: string;
    readonly requests: number;
    readonly clientErrors: number;
    readonly serverErrors: number;
    readonly latencyMs: MonitoringHistogram;
  }[];
  readonly series: readonly MonitoringMetricSeries[];
}
export interface MonitoringStats {
  readonly sampledAt: string;
  readonly scope: "shared-database";
  readonly documents: number;
  readonly libraries: number;
  readonly users: number;
  readonly activeUsers: number;
  readonly files: number;
  readonly fileBytes: number;
  readonly storedObjects: number;
  readonly storedObjectBytes: number;
}
export interface MonitoringOnline {
  readonly sampledAt: string;
  readonly scope: MonitoringScope;
  readonly source: "realtime-connections";
  readonly uniqueUsers: number;
  readonly connections: number;
  readonly activeDocuments: number;
  readonly users: readonly {
    readonly userId: string;
    readonly connections: number;
    readonly documentIds: readonly string[];
  }[];
  readonly nextOffset: number | null;
}
export interface MonitoringLog {
  readonly id: string;
  readonly sequence: number;
  readonly instanceId: string;
  readonly epoch: string;
  readonly createdAt: string;
  readonly pluginId: string | null;
  readonly level: TelemetryLevel;
  readonly module: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly fields: JsonObject;
}
export interface MonitoringLogQuery {
  readonly scope?: MonitoringScope;
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly level?: TelemetryLevel;
  readonly pluginId?: string;
  readonly module?: string;
  readonly requestId?: string;
  readonly since?: string;
}
export interface MonitoringLogs extends MonitoringCoverage {
  readonly items: readonly MonitoringLog[];
  /** Save even empty pages. An expired cursor reports gaps; it never masquerades as an empty history. */
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly gaps: readonly {
    readonly instanceId: string;
    readonly epoch: string;
    readonly reason: "evicted" | "instance-unavailable";
    readonly dropped: number | null;
  }[];
}
export interface MonitoringPageQuery {
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly since?: string;
  readonly until?: string;
}
export interface MonitoringAuditQuery extends MonitoringPageQuery {
  readonly source: "security" | "resource";
  readonly action?: string;
  readonly actorId?: string;
  readonly userId?: string;
  readonly resourceId?: string;
}
export interface MonitoringAuditEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly source: "security" | "resource";
  readonly action: string;
  readonly actorId: string | null;
  readonly userId: string | null;
  readonly resourceId: string | null;
  readonly details: JsonObject | null;
  readonly detailsValid: boolean;
}
export interface MonitoringPage<T> {
  readonly sampledAt: string;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
export interface MonitoringJobs {
  readonly sampledAt: string;
  readonly scope: "shared-database";
  readonly groups: readonly {
    readonly source: "ai" | "projection" | "file-extract";
    readonly kind: string;
    readonly status: string;
    readonly count: number;
  }[];
  readonly expiredLeases: { readonly ai: number; readonly projection: number };
  readonly privateObjectsPendingDeletion: number;
}
export interface MonitoringJobError {
  readonly id: string;
  readonly source: "ai" | "projection" | "file-extract";
  readonly kind: string;
  readonly status: string;
  readonly attempts: number | null;
  readonly error: string;
  readonly updatedAt: string | null;
}
export interface MonitoringAIUsageQuery extends MonitoringPageQuery {
  readonly userId?: string;
  readonly modelId?: string;
  readonly state?: string;
}
export interface MonitoringAIUsage {
  readonly callId: string;
  readonly userId: string;
  readonly modelId: string;
  readonly jobId: string | null;
  readonly state: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly usageStatus: "confirmed" | "unknown" | "invalid";
  readonly ratedTokens: {
    readonly input: number;
    readonly output: number;
    readonly cached: number;
    readonly image: number;
    readonly total: number;
  } | null;
  readonly providerMetrics: Readonly<Record<string, number | null>> | null;
}
export interface MonitoringHealth extends MonitoringCoverage {
  readonly hostVersion: string;
  readonly dependencies: readonly {
    readonly name: string;
    readonly status: "ok" | "unavailable" | "not-probed";
    readonly latencyMs: number | null;
  }[];
}
/** Trusted installed SERVER plugins may collect these operational facts in the background.
 * Browser transport requires an active administrator and a live plugin that declared this service.
 * Never forward these records to ordinary users or AI tools automatically. */
export interface MonitoringServiceV1 {
  stats(
    input: Record<string, never>,
    options?: MonitoringCallOptions,
  ): Promise<MonitoringStats>;
  online(
    input: { readonly offset?: number; readonly limit?: number },
    options?: MonitoringCallOptions,
  ): Promise<MonitoringOnline>;
  metrics(
    input: {
      readonly scope?: MonitoringScope;
      readonly windowSeconds?: number;
    },
    options?: MonitoringCallOptions,
  ): Promise<MonitoringMetrics>;
  logs(
    input: MonitoringLogQuery,
    options?: MonitoringCallOptions,
  ): Promise<MonitoringLogs>;
  audit(
    input: MonitoringAuditQuery,
    options?: MonitoringCallOptions,
  ): Promise<MonitoringPage<MonitoringAuditEntry>>;
  jobs(
    input: Record<string, never>,
    options?: MonitoringCallOptions,
  ): Promise<MonitoringJobs>;
  jobErrors(
    input: {
      readonly source: "ai" | "projection" | "file-extract";
      readonly limit?: number;
    },
    options?: MonitoringCallOptions,
  ): Promise<MonitoringPage<MonitoringJobError>>;
  aiUsage(
    input: MonitoringAIUsageQuery,
    options?: MonitoringCallOptions,
  ): Promise<MonitoringPage<MonitoringAIUsage>>;
  health(
    input: { readonly scope?: MonitoringScope },
    options?: MonitoringCallOptions,
  ): Promise<MonitoringHealth>;
}
export const monitoringServiceToken =
  defineService<MonitoringServiceV1>("monitoring.v1");
export const telemetryServiceToken =
  defineService<TelemetryServiceV1>("telemetry.v1");
