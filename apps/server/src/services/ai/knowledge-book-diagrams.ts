import { Worker } from "node:worker_threads";
import { fromMarkdown } from "mdast-util-from-markdown";

/** Escape flat flowchart node labels in new model output; callers still require successful parsing. */
export function quoteGeneratedBookLabels(markdown: string) {
  const edits: { start: number; end: number; value: string }[] = [];
  const visit = (node: any) => {
    if (
      node.type === "code" &&
      node.lang === "mermaid" &&
      /^\s*(?:flowchart|graph)\b/.test(node.value)
    ) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      const original = markdown.slice(start, end);
      const value = original.replace(
        /\b([A-Za-z][\w-]*)\[(?!["\[])([^"\[\]\n]+)\](?!\])/g,
        (match, id, label, offset) => {
          let quoted = false;
          for (let index = 0; index < offset; index++) {
            if (original[index] !== '"') continue;
            let backslashes = 0;
            for (
              let previous = index - 1;
              previous >= 0 && original[previous] === "\\";
              previous--
            )
              backslashes++;
            if (backslashes % 2 === 0) quoted = !quoted;
          }
          const line = original.slice(
            original.lastIndexOf("\n", offset) + 1,
            offset,
          );
          return quoted || /^\s*(?:>\s*)*%%/.test(line)
            ? match
            : `${id}["${label}"]`;
        },
      );
      if (value !== original) edits.push({ start, end, value });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(markdown));
  for (const edit of edits.reverse())
    markdown =
      markdown.slice(0, edit.start) + edit.value + markdown.slice(edit.end);
  return markdown;
}

export async function validateBookDiagrams(
  pages: { paragraphs: { id: string; markdown: string }[] }[],
  signal: AbortSignal,
) {
  const diagrams: Array<{ id: string; code: string }> = [];
  const visit = (node: any, id: string, markdown: string) => {
    if (node.type === "text" && /```mermaid\b/.test(node.value))
      throw new Error(
        `Mermaid fence in paragraph ${id} must start on its own line, separated from prose`,
      );
    if (node.type === "code") {
      const source = markdown.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      const fence = source.match(/^\s*(`{3,}|~{3,})/)?.[1];
      if (
        fence &&
        !new RegExp(
          `\\n(?:[ \\t]*>[ \\t]*)*[ \\t]*${fence[0]}{${fence.length},}[ \\t\\r]*$`,
        ).test(source)
      )
        throw new Error(
          `Markdown code in paragraph ${id} requires a complete closing fence`,
        );
      if (node.lang === "mermaid") diagrams.push({ id, code: node.value });
    }
    for (const child of node.children ?? []) visit(child, id, markdown);
  };
  for (const page of pages)
    for (const paragraph of page.paragraphs)
      visit(fromMarkdown(paragraph.markdown), paragraph.id, paragraph.markdown);
  if (!diagrams.length) return;
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("./knowledge-book-mermaid-worker.mjs", import.meta.url),
    {
      workerData: diagrams,
      // Parser and DOM allocation are isolated from the request thread.
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    },
  );
  try {
    const result = await new Promise<{
      errors: { id: string; error: string }[];
    }>((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(
        () => reject(new Error("Mermaid syntax validation timed out")),
        30000,
      );
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      worker.once("message", (result) => {
        cleanup();
        resolve(result);
      });
      worker.once("error", (error) => {
        cleanup();
        reject(error);
      });
      worker.once("exit", (code) => {
        cleanup();
        reject(
          new Error(`Mermaid validator exited without a result (code ${code})`),
        );
      });
    });
    if (result.errors.length)
      throw new Error(
        `Invalid Mermaid diagrams in paragraphs: ${result.errors.map((item) => `${item.id}: ${item.error}`).join("\n")}`,
      );
  } finally {
    await worker.terminate();
  }
}
