import { Image, type ImageProps } from "antd";
import { assetUrl } from "@web/shared/api.js";

export function AIAssetImage({
  assetId,
  ...props
}: Omit<ImageProps, "src" | "preview" | "fallback"> & { assetId: string }) {
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
