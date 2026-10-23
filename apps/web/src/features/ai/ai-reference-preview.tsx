import { lazy, Suspense, useEffect, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { ArrowUpRight } from "lucide-react";
import type { AIReference } from "@core/workflows/ai-documents.js";
import { api } from "@web/shared/api.js";
import type { SurfacePreviewData } from "@web/features/documents/surface-preview.js";
const RichPreview = lazy(() => import("@web/features/documents/version-preview.js"));
const MarkdownPreview = lazy(() => import("@web/features/documents/markdown-preview.js"));
const SurfacePreview = lazy(() => import("@web/features/documents/surface-preview.js"));

export function AIReferencePreview({
  reference,
  reveal,
}: {
  reference: AIReference;
  reveal: () => void;
}) {
  const [data, setData] = useState<{
    resource: { title: string };
    value?: any;
    markdown?: string;
    surface?: SurfacePreviewData;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<NonNullable<typeof data>>(
      `/ai/resources/${reference.resourceId}/preview`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [reference.resourceId]);
  return (
    <section className="ai-reference-preview" aria-label="引用文档预览">
      <header>
        <strong>{data?.resource.title ?? reference.label}</strong>
        <Button type="text" size="small" onClick={reveal}>
          打开文档
          <ArrowUpRight size={14} />
        </Button>
      </header>
      <div className="ai-reference-preview-content">
        {error ? (
          <Alert type="error" title={error} />
        ) : !data ? (
          <Spin />
        ) : (
          <Suspense fallback={<Spin />}>
            {typeof data.markdown === "string" ? (
              <MarkdownPreview value={data.markdown} />
            ) : data.value ? (
              <RichPreview value={data.value} />
            ) : data.surface ? (
              <SurfacePreview
                id={reference.resourceId}
                surface={data.surface}
              />
            ) : null}
          </Suspense>
        )}
      </div>
    </section>
  );
}
