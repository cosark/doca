import { z } from "zod";

export const monitoringScope = z
  .enum(["instance", "cluster"])
  .default("cluster");
export const telemetryLevel = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);
const text = z.string().min(1).max(200);
const stamp = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const page = z.object({
  cursor: z.string().min(1).max(16384).nullable().optional(),
  limit: z.number().int().min(1).max(200).default(100),
  since: stamp.optional(),
  until: stamp.optional(),
});
export const monitoringInputs = {
  stats: z.object({}).strict(),
  online: z
    .object({
      offset: z.number().int().min(0).max(1000000).default(0),
      limit: z.number().int().min(1).max(200).default(100),
    })
    .strict(),
  metrics: z
    .object({
      scope: monitoringScope,
      windowSeconds: z.number().int().min(1).max(300).default(60),
    })
    .strict(),
  logs: z
    .object({
      scope: monitoringScope,
      cursor: z.string().min(1).max(65536).nullable().optional(),
      limit: z.number().int().min(1).max(200).default(100),
      level: telemetryLevel.optional(),
      pluginId: text.optional(),
      module: text.optional(),
      requestId: text.optional(),
      since: stamp.optional(),
    })
    .strict(),
  audit: page
    .extend({
      source: z.enum(["security", "resource"]),
      action: text.optional(),
      actorId: text.optional(),
      userId: text.optional(),
      resourceId: text.optional(),
    })
    .strict(),
  jobs: z.object({}).strict(),
  jobErrors: z
    .object({
      source: z.enum(["ai", "projection", "file-extract"]),
      limit: z.number().int().min(1).max(200).default(100),
    })
    .strict(),
  aiUsage: page
    .extend({
      userId: text.optional(),
      modelId: text.optional(),
      state: text.optional(),
    })
    .strict(),
  health: z.object({ scope: monitoringScope }).strict(),
};
export const telemetryLogInput = z
  .object({
    level: telemetryLevel,
    module: text,
    message: z.string().min(1).max(2000),
    requestId: text.optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const telemetryMetricInput = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z][a-z0-9_.-]*$/),
    kind: z.enum(["counter", "gauge", "histogram"]),
    value: z.number().finite(),
    labels: z
      .record(
        z
          .string()
          .regex(/^[a-z][a-zA-Z0-9_]*$/)
          .max(40),
        z.string().max(100),
      )
      .default({}),
  })
  .strict();
