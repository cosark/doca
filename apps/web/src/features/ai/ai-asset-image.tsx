import { Image, type ImageProps } from "antd";
import { assetUrl } from "@web/shared/api.js";
import { useAIChatRuntime } from "./ai-runtime.js";

export function AIAssetImage({
  assetId,
  ...props
}: Omit<ImageProps, "src" | "preview" | "fallback"> & { assetId: string }) {
  const runtime = useAIChatRuntime();
  if (!runtime.workspaceActions) return <span className="ai-asset-unavailable">{props.alt}</span>;
  const original = assetUrl(assetId);
  return (
    <Image
      {...props}
      src={`${original}?variant=thumbnail`}
      // The thumbnail worker runs asynchronously; keep a newly saved image viewable.
      fallback={original}
      preview={{ src: original }}
    />
  );
}
