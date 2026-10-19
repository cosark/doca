import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
if (process.env.DOCA_QA_ISOLATED !== "1")
  throw Error("Disposable MCP acceptance only");
const fixture = JSON.parse(
  await readFile(resolve(".cache/qa-mcp.json"), "utf8"),
);
if (fixture.origin !== "http://127.0.0.1:39472")
  throw Error("Unexpected QA origin");
const directory = join(fixture.root, "codex-client");
await mkdir(directory, { recursive: true });
const transcript = resolve(".cache/qa-mcp-codex.jsonl"),
  last = resolve(".cache/qa-mcp-codex-final.json");
const configuration = `mcp_servers={doca_demo={url=${JSON.stringify(fixture.origin + "/api/v1/mcp")},bearer_token_env_var="DOCA_MCP_QA_TOKEN",required=true,tool_timeout_sec=180,tools={doca_call={approval_mode="approve"}}}}`;
const prompt = `这是 Doca MCP 的真实客户端验收，已经授权你在这个隔离测试站创建以下内容并在当前本地目录写入验收文件。只用 doca_demo MCP 操作 Doca，不能用 curl/fetch 或其他 HTTP 工具替代 MCP。不要修改 Doca 源码。token 已通过环境变量提供，不能输出 token。请完成所有项目，不要只描述计划：
1. 使用 doca_tools 打开 purpose 为完整本次任务的上下文，按需用 doca_describe_tools 加载 schema，编辑前使用 doca_load_skill 读取对应完整手册。
2. 创建原生富文本《Codex MCP 验收报告》，写入本次验收日期 2026-10-20、测试总数 12、通过 12、失败 0 和结论；保存后读回。
3. 创建原生画板《Codex MCP 验收画板》，包含“测试平台 → Doca MCP → 用户报告”的三个可编辑节点和连接线；保存读回并使用 canvas_view 查看真实图像。
4. 创建原生 PPT《Codex MCP 验收 PPT》，至少一页含标题“自动测试报告”和“12 项通过，0 项失败”；保存后读回。
5. 创建原生表格《Codex MCP 验收 Excel》，填写通过12、失败0并加入 SUM 公式；保存后读回。不要未验证就声称公式计算通过。
6. 在 Doca 创建文件夹《Codex MCP 验收附件》。在当前本地目录写 source-report.txt，正文为“Codex MCP 自动报告：12 项通过，0 项失败。”；通过 file_upload_begin/chunk/complete 将真实本机文件上传到这个文件夹，然后通过 file_content 下载回 downloaded-report.txt，在本机计算两个文件 SHA256 并确认字节一致。读取文件块时必须遵循返回的版本和 nextOffset。
7. 通过 file_create 创建可下载的 excel 文件 codex-mcp-metrics.xlsx（两列表格：通过12、失败0），保存到同一文件夹，再用 file_content 下载到当前本地目录，确认是 ZIP/XLSX 文件（PK 签名）。
8. 最后关闭 MCP 上下文。最终回复只写 JSON：passed、documents（每项 id/format/title）、folderId、uploadedFileId、xlsxFileId、sourceSha256、downloadSha256、xlsxSignatureVerified、canvasViewed。任何失败如实记录，不能忽略；已保存成果保留。`;
const child = spawn(
  "codex",
  [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--output-last-message",
    last,
    "-C",
    directory,
    "-s",
    "workspace-write",
    "-c",
    'approval_policy="never"',
    "-c",
    configuration,
    prompt,
  ],
  {
    env: { ...process.env, DOCA_MCP_QA_TOKEN: fixture.personal.token },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let stdout = "",
  stderr = "";
const stream = createWriteStream(transcript, { mode: 0o600 });
child.stdout.on("data", (data) => {
  stdout += data;
  stream.write(data);
});
child.stderr.on("data", (data) => {
  stderr += data;
});
const timer = setTimeout(() => child.kill("SIGTERM"), 12 * 60 * 1000);
const code = await new Promise((resolve) => child.on("close", resolve));
clearTimeout(timer);
await new Promise((resolve) => stream.end(resolve));
await writeFile(resolve(".cache/qa-mcp-codex-stderr.log"), stderr, {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    exitCode: code,
    transcript,
    final: last,
    directory,
    eventCount: stdout.trim().split("\n").length,
  }),
);
if (code !== 0) process.exitCode = 1;
