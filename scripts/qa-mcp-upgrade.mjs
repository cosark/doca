// Run seed against the actual released image, then check against this checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
if (process.env.DOCA_QA_ISOLATED !== "1")
  throw Error("Isolated upgrade databases only");
const source = process.env.DOCA_MCP_SOURCE_ROOT || process.cwd();
const root = process.env.DOCA_MCP_UPGRADE_ROOT;
if (!root) throw Error("DOCA_MCP_UPGRADE_ROOT is required");
await mkdir(root, { recursive: true });
const load = (relative) => import(join(source, relative));
const { openDatabase } = await load("packages/db/src/connection.ts");
const config = process.env.DOCA_MCP_UPGRADE_POSTGRES
  ? { driver: "postgres", url: process.env.DOCA_MCP_UPGRADE_POSTGRES }
  : { driver: "sqlite", path: join(root, "released.db") };
const mode = process.argv[2];
assert(["seed", "check"].includes(mode));
const db = await openDatabase(config);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const sha = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
async function snapshot(tables) {
  const result = {};
  for (const table of tables) {
    const rows = await db.selectFrom(table).selectAll().execute();
    if (table === "schema_baseline")
      rows.forEach((row) => delete row.structure_json);
    result[table] = {
      rows: rows.length,
      hash: sha(
        rows
          .map(canonical)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ),
    };
  }
  return result;
}
try {
  if (mode === "seed") {
    const { createUser } = await load(
      "packages/core/src/modules/identity/passwords.ts",
    );
    const { createContent } = await load(
      "packages/core/src/workflows/resources.ts",
    );
    const { readAIDocument } = await load(
      "packages/core/src/workflows/ai-documents.ts",
    );
    const user = {
      ...(await createUser(
        db,
        {
          login: "mcpupgrade",
          displayName: "Retained release data",
          password: "isolated-mcp-upgrade-2026",
        },
        { bootstrap: true },
      )),
      admin: 1,
    };
    const document = await createContent(db).create(user, {
      kind: "document",
      format: "markdown",
      title: "升级前报告",
      markdown: "# Released report\n原始正文、权限和历史不得改变。",
    });
    await readAIDocument(db, { actor: user }, document.id);
    const legacyToken = "doca_mcp_" + "9".repeat(64);
    await db
      .insertInto("ai_mcp_keys")
      .values({
        id: "retired-mcp-key",
        user_id: user.id,
        name: "Never-used retired fixture",
        token_hash: createHash("sha256").update(legacyToken).digest("hex"),
        resource_ids: JSON.stringify([document.id]),
        writable: 0,
        expires_at: "2030-01-01T00:00:00.000Z",
        created_at: new Date().toISOString(),
      })
      .execute();
    const tables = (await db.introspection.getTables())
      .filter(
        (table) => table.schema === undefined || table.schema === "public",
      )
      .map((table) => table.name)
      .sort();
    const version = JSON.parse(
      await readFile(join(source, "package.json"), "utf8"),
    ).version;
    const before = await snapshot(tables);
    await writeFile(
      join(root, "before.json"),
      JSON.stringify(
        { version, tables, before, userId: user.id, documentId: document.id },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        mode,
        releasedVersion: version,
        engine: config.driver,
        retainedTables: tables.length,
        documentId: document.id,
      }),
    );
  } else {
    const before = JSON.parse(
      await readFile(join(root, "before.json"), "utf8"),
    );
    const after = await snapshot(before.tables);
    assert.deepEqual(
      after,
      before.before,
      "Released data changed during additive MCP startup",
    );
    const newTables = [
      "mcp_user_settings",
      "mcp_services",
      "mcp_contexts",
      "mcp_tool_calls",
    ];
    for (const table of newTables)
      assert.deepEqual(await db.selectFrom(table).selectAll().execute(), []);
    const { authenticateMcp } = await load(
      "apps/server/src/services/ai/mcp-access.ts",
    );
    await assert.rejects(() =>
      authenticateMcp(db, "Bearer doca_mcp_" + "9".repeat(64)),
    );
    const baseline = await db
      .selectFrom("schema_baseline")
      .selectAll()
      .executeTakeFirstOrThrow();
    const report = {
      passed: true,
      mode,
      releasedVersion: before.version,
      engine: config.driver,
      retainedTables: before.tables.length,
      baseline: baseline.id,
      tableHashes: after,
      newTablesEmpty: true,
      legacyRecordPreservedAndCredentialRejected: true,
    };
    const destination = process.env.DOCA_MCP_UPGRADE_REPORT;
    if (destination)
      await writeFile(resolve(destination), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        passed: true,
        releasedVersion: before.version,
        engine: config.driver,
        retainedTables: before.tables.length,
        newTablesEmpty: true,
        legacyRecordPreservedAndCredentialRejected: true,
      }),
    );
  }
} finally {
  await db.destroy();
}
