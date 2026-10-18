const titleSegments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emojiStart = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/u;

export function documentFavicon(title: string): string | null {
  const trimmed = title.trim();
  const first = titleSegments.segment(trimmed)[Symbol.iterator]().next().value;
  if (!first || !emojiStart.test(first.segment) || !/^\s+\S/u.test(trimmed.slice(first.segment.length)))
    return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><text x="32" y="54" text-anchor="middle" font-size="56" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${first.segment}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
