import { Button, Popover } from "antd";
import { FileText, Quote } from "lucide-react";
import type { AIReference } from "@core/workflows/ai-documents.js";
import { useAIChatRuntime } from "./ai-runtime.js";
const formats: Record<string, string> = {
  rich_text: "文档",
  markdown: "Markdown",
  spreadsheet: "表格",
  canvas: "画板",
  presentation: "演示",
};
const compact = (s: string, max: number) =>
  s.replace(/\s+/g, " ").trim().slice(0, max) + (s.length > max ? "…" : "");
export function referenceLabel(ref: AIReference) {
  const title = compact(ref.label ?? "未命名文档", 28);
  return ref.anchor
    ? `${title} · ${compact(ref.anchor.quote || ref.description || "选中内容", 24)}`
    : `${formats[ref.format ?? ""] ?? "文档"} · ${title}`;
}
export function AIReferenceTag({
  reference,
  reveal,
}: {
  reference: AIReference;
  reveal: () => void;
}) {
  const ReferencePreview = useAIChatRuntime().workspace?.ReferencePreview;
  const region = !!reference.anchor;
  const label = referenceLabel(reference);
  const button = (
    <Button
      type="text"
      size="small"
      className={`ai-inline-reference ai-inline-reference-${region ? "region" : "document"}`}
      title={
        region
          ? `定位内容：${reference.anchor.quote || reference.description || reference.label}`
          : `预览文档：${reference.label}`
      }
      aria-label={`${region ? "定位内容" : "预览文档"}：${label}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={region || !ReferencePreview ? reveal : undefined}
    >
      {region ? <Quote size={12} /> : <FileText size={12} />}@{label}
    </Button>
  );
  return region || !ReferencePreview ? (
    button
  ) : (
    <Popover
      trigger="click"
      placement="top"
      destroyOnHidden
      styles={{ container: { borderRadius: 12, padding: 0 } }}
      content={<ReferencePreview reference={reference} reveal={reveal} />}
    >
      {button}
    </Popover>
  );
}
