import { splitTitleIcon } from "./resource-title.js";
import type { Resource } from "../api.js";
import richTextIcon from "../assets/document-icons/rich_text.svg";
import markdownIcon from "../assets/document-icons/markdown.svg";
import spreadsheetIcon from "../assets/document-icons/spreadsheet.svg";
import presentationIcon from "../assets/document-icons/presentation.svg";
import canvasIcon from "../assets/document-icons/canvas.svg";
import libraryIcon from "../assets/document-icons/library.svg";

const formatIcons: Record<Resource["format"], string> = {
  rich_text: richTextIcon,
  markdown: markdownIcon,
  spreadsheet: spreadsheetIcon,
  presentation: presentationIcon,
  canvas: canvasIcon,
};

export function documentFavicon(
  resource: Pick<Resource, "title" | "kind" | "format"> | null,
): string | null {
  if (!resource) return null;
  const { icon } = splitTitleIcon(resource.title.trim());
  if (!icon)
    return resource.kind === "library" ? libraryIcon : formatIcons[resource.format];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><text x="32" y="54" text-anchor="middle" font-size="56" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${icon}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
