import type {
  BookClaim,
  BookPage,
} from "@core/modules/knowledge-books/protocol.js";
import { fromMarkdown } from "mdast-util-from-markdown";

export type BookPageBatch = { pages: BookPage[]; claims: BookClaim[] };
/** Neighboring paragraphs clarify references; they are context, not extra audit targets. */
export function bookNeighborContext(
  pages: BookPage[],
  selected: BookPage[],
  limit = 6000,
) {
  const included = new Set(
    selected.flatMap((page) =>
      page.paragraphs.map((paragraph) => paragraph.id),
    ),
  );
  const candidates: Array<{
    distance: number;
    chapter: string;
    paragraphId: string;
    markdown: string;
  }> = [];
  for (const part of selected) {
    const page = pages.find((candidate) => candidate.id === part.id);
    if (!page) continue;
    const indices = page.paragraphs.flatMap((paragraph, index) =>
      included.has(paragraph.id) ? [index] : [],
    );
    for (const [index, paragraph] of page.paragraphs.entries()) {
      if (included.has(paragraph.id)) continue;
      const distance = Math.min(
        ...indices.map((selectedIndex) => Math.abs(index - selectedIndex)),
      );
      if (distance <= 2)
        candidates.push({
          distance,
          chapter: page.title,
          paragraphId: paragraph.id,
          markdown: paragraph.markdown,
        });
    }
  }
  const result: Array<{
    chapter: string;
    paragraphId: string;
    markdown: string;
  }> = [];
  let size = 0;
  for (const { distance, ...paragraph } of candidates.sort(
    (a, b) => a.distance - b.distance,
  )) {
    if (size + paragraph.markdown.length > limit) continue;
    result.push(paragraph);
    size += paragraph.markdown.length;
  }
  return result;
}
/** Assertion hints accompany complete paragraphs; they never replace or truncate the reviewed text. */
export function bookInspectionAssertions(pages: BookPage[]) {
  return pages
    .flatMap((page) =>
      page.paragraphs.flatMap((paragraph) =>
        paragraph.markdown
          .split(/\n|[。；]/)
          .map((excerpt) => excerpt.trim())
          .filter(
            (excerpt) =>
              excerpt.length &&
              !/^(?:#{1,6}\s|`{3,}|~{3,}|(?:flowchart|sequenceDiagram|stateDiagram(?:-v2)?)\b)/.test(
                excerpt,
              ),
          )
          .flatMap((excerpt) => {
            // A correct byte sum must not mask an incorrect number of fields.
            // Keep count clauses separately, alongside the unchanged full text.
            const counts = [
              ...excerpt.matchAll(
                /(?:(?:前|总共|共|仅|只有|第)\s*)?\d+(?:\.\d+)?\s*(?:个|种|项|条|步)[^，。；\n\s]{0,20}?(?=共占|占用|占|组成|构成|的|，|。|；|$)/g,
              ),
              ...excerpt.matchAll(
                /\b\d+\s+(?:fixed[- ]length\s+)?(?:fields|items|steps|messages)\b/gi,
              ),
            ].map((match) => match[0]);
            return [...new Set([excerpt, ...counts])].map((part) => ({
              paragraphId: paragraph.id,
              excerpt: part,
            }));
          }),
      ),
    )
    .map((assertion, index) => ({ ...assertion, id: `a${index}` }));
}
/** Include related original source blocks: a citation is an anchor, not the whole normative scope. */
export function bookEvidenceContext<
  T extends { id: string; sourceId: string; text: string },
>(
  evidence: T[],
  claims: Pick<BookClaim, "evidenceIds">[],
  characterLimit = 160000,
  contextText = "",
): T[] {
  const anchors = new Set(claims.flatMap((claim) => claim.evidenceIds));
  const selected = new Set(evidence.filter((item) => anchors.has(item.id)));
  let characters = [...selected].reduce(
    (sum, item) => sum + item.text.length,
    0,
  );
  const sources = new Map<string, T[]>();
  for (const item of evidence) {
    const items = sources.get(item.sourceId) ?? [];
    items.push(item);
    sources.set(item.sourceId, items);
  }
  const related = [...sources.values()].flatMap((items) => {
    const positions = items.flatMap((item, index) =>
      anchors.has(item.id) ? [index] : [],
    );
    return positions.length
      ? items.map((item, index) => ({
          item,
          distance: Math.min(
            ...positions.map((position) => Math.abs(index - position)),
          ),
        }))
      : [];
  });
  // Keep cited blocks, then select actual assertion terms before proximity. A
  // definition can cite an early block while its state algorithm occurs later.
  const terms = (text: string) =>
    new Set(
      (
        text.match(/(?:[A-Za-z]|[0-9]+(?=[A-Za-z_-]))[A-Za-z0-9_.$-]{2,}/g) ??
        []
      ).flatMap((word) => {
        const exact = word.toLowerCase();
        const camel = word
          .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/\s+/);
        const parts = [
          exact,
          ...camel,
          ...[exact, ...camel].flatMap((part) => part.split(/[._$-]+/)),
        ].filter((part) => part.length >= 3);
        return [
          ...parts,
          ...parts
            .filter((part) => part.endsWith("s") && part.length > 3)
            .map((part) => part.slice(0, -1)),
        ];
      }),
    );
  const wanted = terms(contextText);
  const frequency = new Map<string, number>();
  const tokens = new Map(related.map(({ item }) => [item, terms(item.text)]));
  for (const words of tokens.values())
    for (const word of wanted)
      if (words.has(word)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const relevance = (item: T) =>
    [...wanted].reduce(
      (score, word) =>
        score +
        (tokens.get(item)!.has(word)
          ? Math.log((related.length + 1) / (frequency.get(word)! + 1))
          : 0),
      0,
    );
  const ranked = related.map((entry) => ({
    ...entry,
    relevance: relevance(entry.item),
  }));
  for (const { item } of ranked.sort(
    (a, b) => b.relevance - a.relevance || a.distance - b.distance,
  )) {
    if (selected.has(item) || characters + item.text.length > characterLimit)
      continue;
    selected.add(item);
    characters += item.text.length;
  }
  return evidence.filter((item) => selected.has(item));
}
/** Bound vendor concurrency and drain cancelled workers before returning a failure. */
export async function runBookBatches<T, R>(
  items: T[],
  signal: AbortSignal,
  run: (item: T, index: number, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length),
    controller = new AbortController();
  const activeSignal = AbortSignal.any([signal, controller.signal]);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      activeSignal.throwIfAborted();
      const index = cursor++;
      results[index] = await run(items[index]!, index, activeSignal);
    }
  };
  const workers = Array.from({ length: Math.min(2, items.length) }, worker);
  try {
    await Promise.all(workers);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled(workers);
    throw error;
  }
  return results;
}

export function splitBookPageBatch(
  group: BookPageBatch,
): BookPageBatch[] | undefined {
  const paragraphs = group.pages.flatMap((page) =>
    page.paragraphs.map((paragraph) => ({ page, paragraph })),
  );
  if (paragraphs.length < 2) return;
  const middle = Math.ceil(paragraphs.length / 2);
  return [paragraphs.slice(0, middle), paragraphs.slice(middle)].map(
    (items) => {
      const pages = new Map<string, BookPage>();
      for (const { page, paragraph } of items) {
        if (!pages.has(page.id))
          pages.set(page.id, { ...page, paragraphs: [] });
        pages.get(page.id)!.paragraphs.push(paragraph);
      }
      const ids = new Set(items.flatMap((item) => item.paragraph.claimIds));
      return {
        pages: [...pages.values()],
        claims: group.claims.filter((claim) => ids.has(claim.id)),
      };
    },
  );
}
/** Whole paragraphs are the smallest unit: never cut a code fence, diagram or citation. */
export function bookPageBatches(
  allPages: BookPage[],
  allClaims: BookClaim[],
  characterLimit = 16000,
  claimLimit = 40,
): BookPageBatch[] {
  const groups: BookPageBatch[] = [];
  let pages: BookPage[] = [],
    characters = 0,
    ids = new Set<string>();
  const flush = () => {
    if (!pages.length) return;
    groups.push({
      pages,
      claims: allClaims.filter((claim) => ids.has(claim.id)),
    });
    pages = [];
    characters = 0;
    ids = new Set();
  };
  for (const page of allPages)
    for (const paragraph of page.paragraphs) {
      const next = new Set([...ids, ...paragraph.claimIds]);
      if (
        pages.length &&
        (characters + paragraph.markdown.length > characterLimit ||
          next.size > claimLimit ||
          (!pages.some((part) => part.id === page.id) && pages.length >= 8))
      )
        flush();
      const target = pages.find((part) => part.id === page.id);
      if (target) target.paragraphs.push(paragraph);
      else pages.push({ ...page, paragraphs: [paragraph] });
      paragraph.claimIds.forEach((id) => ids.add(id));
      characters += paragraph.markdown.length;
    }
  flush();
  return groups;
}

/** Interpret only an explicit character goal; never invent one for saved configuration. */
export function bookCharacterGoal(goal: string): number | undefined {
  const match =
    /(\d[\d,]*(?:\.\d+)?)\s*(万|[kK])?\s*(?:个?字|characters)/i.exec(goal);
  let count: number;
  if (match)
    count =
      Number(match[1]!.replaceAll(",", "")) *
      (match[2] === "万" ? 10000 : match[2] ? 1000 : 1);
  else {
    const chinese = /([一二两三四五六七八九十百千万]+)\s*个?字/.exec(goal)?.[1];
    if (!chinese) return;
    const digits: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
    let section = 0,
      digit = 0,
      total = 0;
    for (const char of chinese) {
      if (digits[char]) digit = digits[char]!;
      else if (char === "万") {
        total += (section + digit || 1) * 10000;
        section = 0;
        digit = 0;
      } else {
        section += (digit || 1) * units[char]!;
        digit = 0;
      }
    }
    count = total + section + digit;
  }
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

export function bookContentMetrics(pages: BookPage[], claims: BookClaim[]) {
  const cited = new Set(
    pages.flatMap((page) =>
      page.paragraphs.flatMap((paragraph) => paragraph.claimIds),
    ),
  );
  const markdown = pages.flatMap((page) =>
    page.paragraphs.map((paragraph) => paragraph.markdown),
  );
  const prose = (node: {
    type: string;
    value?: string;
    children?: any[];
  }): string =>
    node.type === "code"
      ? ""
      : (node.value ?? (node.children ?? []).map(prose).join(""));
  const trees = markdown.map((text) => fromMarkdown(text));
  const diagramTypes = (node: any): string[] =>
    node.type === "code" && node.lang === "mermaid"
      ? [node.value.trim().match(/^[A-Za-z][\w-]*/)?.[0] ?? "unknown"]
      : (node.children ?? []).flatMap(diagramTypes);
  const diagrams = trees.flatMap(diagramTypes);
  return {
    pageCount: pages.length,
    paragraphCount: markdown.length,
    markdownCharacters: markdown.reduce((sum, text) => sum + text.length, 0),
    bodyCharacters: trees.reduce((sum, tree) => sum + prose(tree).length, 0),
    chineseCharacters: trees.reduce(
      (sum, tree) => sum + (prose(tree).match(/\p{Script=Han}/gu)?.length ?? 0),
      0,
    ),
    diagramCount: diagrams.length,
    diagramTypes: Object.fromEntries(
      [...new Set(diagrams)].map((type) => [
        type,
        diagrams.filter((item) => item === type).length,
      ]),
    ),
    claimCount: claims.length,
    citedClaimCount: claims.filter((claim) => cited.has(claim.id)).length,
    topLevelCategories: [
      ...new Set(pages.map((page) => page.path[0]).filter(Boolean)),
    ],
  };
}
