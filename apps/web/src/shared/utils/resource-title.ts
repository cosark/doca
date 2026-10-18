const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const iconPattern =
  /\p{Extended_Pictographic}|^\p{Regional_Indicator}{2}$|^[#*0-9]\uFE0F?\u20E3$/u;

export function titleIcon(value: string): string | null {
  const first = segmenter.segment(value)[Symbol.iterator]().next()
    .value?.segment;
  return first && first === value && iconPattern.test(first) ? first : null;
}

/** Presentation only: the original title remains the sole stored value. */
export function splitTitleIcon(title: string): {
  icon: string | null;
  text: string;
} {
  const first = segmenter.segment(title)[Symbol.iterator]().next()
    .value?.segment;
  if (!first || !titleIcon(first)) return { icon: null, text: title };
  const remaining = title.slice(first.length);
  if (!/^[ \t\u00a0]+\S/u.test(remaining)) return { icon: null, text: title };
  return { icon: first, text: remaining.replace(/^[ \t\u00a0]+/u, "") };
}

/** Editing also permits an icon with an empty text draft; it does not rewrite the title. */
export function titleEditParts(title: string) {
  const first = segmenter.segment(title)[Symbol.iterator]().next()
    .value?.segment;
  const space =
    first && titleIcon(first)
      ? /^[ \t\u00a0]+/u.exec(title.slice(first.length))?.[0]
      : undefined;
  if (!first || !space) return { icon: null, text: title, prefix: "" };
  const prefix = first + space;
  return { icon: first, text: title.slice(prefix.length), prefix };
}

export function withTitleIcon(title: string, icon: string | null) {
  const { text } = splitTitleIcon(title);
  return icon ? `${icon} ${text}` : text;
}
