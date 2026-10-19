import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import Sqlite from "better-sqlite3";
import { unzipSync } from "fflate";
import { xlsxToSnapshot } from "@smartdoca/sheet/xlsx";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
if (process.env.DOCA_QA_ISOLATED !== "1")
  throw Error("Disposable MCP acceptance only");
const fixture = JSON.parse(
  await readFile(resolve(".cache/qa-mcp.json"), "utf8"),
);
const result = JSON.parse(
  await readFile(resolve(".cache/qa-mcp-codex-final.json"), "utf8"),
);
assert(result.passed, JSON.stringify(result));
const events = (await readFile(resolve(".cache/qa-mcp-codex.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const calls = events
  .map((event) => event.item)
  .filter(
    (item) =>
      item?.type === "mcp_tool_call" &&
      item.server === "doca_demo" &&
      item.status === "completed",
  );
assert(calls.some((item) => item.tool === "doca_call"));
assert(calls.some((item) => item.tool === "doca_load_skill"));
assert(calls.some((item) => item.tool === "doca_context_close"));
assert(
  !events.some(
    (event) =>
      event.item?.type === "command_execution" &&
      /\bcurl\b|fetch\s*\(.*39472|requests\.(get|post).*39472/.test(
        event.item.command ?? "",
      ),
  ),
  "HTTP shortcuts are not MCP acceptance",
);
const client = new Client({
  name: "independent-codex-result-verifier",
  version: "1",
});
await client.connect(
  new StreamableHTTPClientTransport(new URL(fixture.origin + "/api/v1/mcp"), {
    requestInit: {
      headers: { Authorization: `Bearer ${fixture.personal.token}` },
    },
  }),
);
async function rpc(name: string, args: Record<string, unknown>) {
  const response: any = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  return response.structuredContent.result;
}
const context = await rpc("doca_tools", {
  purpose: "独立读回 Codex 已保存的验收成果，不改写文档。",
});
const run = (tool: string, input: Record<string, unknown>) =>
  rpc("doca_call", {
    contextId: context.contextId,
    requestId: randomUUID(),
    tool,
    input,
  });
const db = new Sqlite(fixture.database, { readonly: true });
try {
  assert.equal(result.documents.length, 4);
  for (const doc of result.documents) {
    const record: any = db
      .prepare("select owner_id, format, title from resources where id=?")
      .get(doc.id);
    assert.equal(record.owner_id, fixture.adminId);
    assert.equal(record.format, doc.format);
    assert.equal(record.title, doc.title);
    const read = await run("document_read", {
      resourceId: doc.id,
      view: "content",
    });
    assert(read.seq > 0);
    const native = JSON.parse(read.content),
      serialized = JSON.stringify(native);
    assert(serialized.includes(doc.format === "canvas" ? "测试平台" : "12"));
    if (doc.format === "presentation") assert(native.slideOrder.length >= 1);
    if (doc.format === "spreadsheet") assert(/SUM\(/i.test(serialized));
  }
  async function download(fileId: string) {
    const chunks: Buffer[] = [];
    let offset: number | null = 0,
      version: number | undefined;
    while (offset !== null) {
      const chunk = await run("file_content", {
        fileId,
        offset,
        ...(version ? { version } : {}),
      });
      chunks.push(Buffer.from(chunk.base64, "base64"));
      offset = chunk.nextOffset;
      version = chunk.version;
    }
    return Buffer.concat(chunks);
  }
  const directory = join(fixture.root, "codex-client");
  const source = await readFile(join(directory, "source-report.txt")),
    local = await readFile(join(directory, "downloaded-report.txt")),
    remote = await download(result.uploadedFileId);
  assert(source.equals(local));
  assert(source.equals(remote));
  const sha256 = createHash("sha256").update(source).digest("hex");
  assert.equal(sha256, result.sourceSha256);
  assert.equal(sha256, result.downloadSha256);
  const xlsx = await download(result.xlsxFileId);
  const archive = unzipSync(xlsx);
  assert(archive["xl/workbook.xml"]);
  assert(archive["xl/worksheets/sheet1.xml"]);
  const workbook = await xlsxToSnapshot(new Uint8Array(xlsx), "mcp-verified");
  assert(JSON.stringify(workbook).includes("12"));
  assert(JSON.stringify(workbook).includes("通过"));
  assert(xlsx.subarray(0, 2).equals(Buffer.from("PK")));
  const folder: any = db
    .prepare("select name, owner_id from file_folders where id=?")
    .get(result.folderId);
  assert.equal(folder.owner_id, fixture.adminId);
  const delegated = JSON.parse(
    await readFile(
      resolve("docs/verification/mcp-2026-10-20/http-client.json"),
      "utf8",
    ),
  ).delegated;
  assert.equal(
    (
      db
        .prepare("select owner_id from resources where id=?")
        .get(delegated.id) as any
    ).owner_id,
    fixture.userId,
  );
  const report = {
    ...result,
    client: "codex-cli 0.162.1",
    independentReadback: true,
    mcpCallsCompleted: calls.length,
    fileBytesVerified: source.length,
    xlsxArchiveVerified: true,
    delegatedOwnershipVerified: true,
    documents: result.documents.map((doc: any) => ({
      ...doc,
      url: `${fixture.origin}/#/r/${doc.id}`,
    })),
  };
  await writeFile(
    resolve("docs/verification/mcp-2026-10-20/codex.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    resolve("docs/verification/mcp-2026-10-20/codex-mcp-metrics.xlsx"),
    xlsx,
  );
  await rpc("doca_context_close", { contextId: context.contextId });
  console.log(JSON.stringify(report));
} finally {
  db.close();
  await client.close();
}
