import { z } from "zod";

/** Host-owned persisted declarations; not an SDK compatibility adapter. */
export const pluginStorageIdentifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/)
  .refine((value) => !Object.hasOwn(Object.prototype, value));
export const pluginDatabaseSchemaParser = z
  .object({
    version: z.literal(1),
    tables: z.record(
      pluginStorageIdentifier,
      z
        .object({
          columns: z.record(
            pluginStorageIdentifier,
            z
              .object({
                type: z.enum(["text", "integer", "real"]),
                nullable: z.boolean(),
              })
              .strict(),
          ),
          primaryKey: z.array(pluginStorageIdentifier).min(1).max(16),
          unique: z
            .array(z.array(pluginStorageIdentifier).min(1).max(16))
            .max(16),
        })
        .strict(),
    ),
  })
  .strict();
export const pluginStorageDeclarationParser = z
  .object({
    storageVersion: z.literal(2),
    schema: pluginDatabaseSchemaParser.nullable(),
  })
  .strict();
