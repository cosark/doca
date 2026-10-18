import { splitTitleIcon } from "./resource-title.js";

export function documentFavicon(title: string): string | null {
  const { icon } = splitTitleIcon(title.trim());
  if (!icon) return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><text x="32" y="54" text-anchor="middle" font-size="56" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${icon}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
