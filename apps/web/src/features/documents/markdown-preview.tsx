import {
  MarkdownPreview,
  type MarkdownPreviewProps,
} from "@smartdoca/markdown";
import { useI18n } from "@web/shared/i18n.js";
import { assetUrl } from "@web/shared/api.js";
import { platformAssetId } from "@web/shared/utils/asset-path.js";
import { memo, useCallback } from "react";
import { useAttachmentPreview } from "./attachment-preview.js";
import "@smartdoca/markdown/style.css";
import "katex/dist/katex.min.css";
import "@web/features/documents/markdown.css";
function Preview({
  value,
  trash = false,
  audit = false,
  interaction,
  onImagePreview,
  resolveImageUrl: providedResolver,
  messages,
}: MarkdownPreviewProps & {
  trash?: boolean;
  audit?: boolean;
}) {
  const { locale } = useI18n();
  const attachmentPreview = useAttachmentPreview({ trash, audit });
  // The package rebuilds its Markdown renderers when this callback changes.
  // Reader outline updates must not remount Mermaid and clear its SVG.
  const resolveImageUrl = useCallback(
    (path: string) => {
      const id = platformAssetId(path);
      return id
        ? assetUrl(id) + (audit ? "?audit=1" : trash ? "?trashPreview=1" : "")
        : "";
    },
    [audit, trash],
  );
  return (
    <div className="doca-markdown markdown-preview-only">
      {attachmentPreview.dialog}
      <MarkdownPreview
        locale={locale}
        value={value}
        interaction={interaction}
        resolveImageUrl={providedResolver ?? resolveImageUrl}
        onImagePreview={
          onImagePreview ?? attachmentPreview.onMarkdownImagePreview
        }
        messages={messages}
      />
    </div>
  );
}
export default memo(Preview);
