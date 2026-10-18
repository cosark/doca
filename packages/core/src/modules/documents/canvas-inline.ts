import { fail } from "../../shared/errors.js";

/** Only native inline envelopes inside rich text contribute identity or references. */
export function canvasInlineElements(value: any) {
  const elements: {
    type: string;
    id: string;
    label: string;
    userId?: string;
    documentId?: string;
  }[] = [];
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.tag === "Text" && Array.isArray(node.data?.richText?.value))
      for (const paragraph of node.data.richText.value) {
        if (!Array.isArray(paragraph?.children)) continue;
        for (const child of paragraph.children) {
          if (child.type !== "inline" || !child.inline) continue;
          const atom = child.inline;
          if (
            !["custom:user-mention", "custom:document-reference"].includes(
              atom.type,
            )
          )
            continue;
          const key =
            atom.type === "custom:user-mention" ? "userId" : "documentId";
          if (
            typeof atom.id !== "string" ||
            !uuid.test(atom.id) ||
            typeof atom.label !== "string" ||
            atom.label.length > 1000 ||
            !uuid.test(atom.data?.[key] ?? "")
          )
            fail(400, "画板行内引用无效", { code: "canvas_inline_invalid" });
          elements.push({
            type: atom.type,
            id: atom.id,
            label: atom.label,
            [key]: atom.data[key],
          });
        }
      }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(value.scene);
  return elements;
}
