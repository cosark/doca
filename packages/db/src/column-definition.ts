/** Remove only top-level DEFAULT and NULL/NOT NULL clauses; retain every other constraint. */
export function fixedSqliteColumn(definition: string) {
  const tokens: string[] = [];
  let token = "",
    depth = 0,
    quoted = "";
  for (let i = 0; i < definition.length; i++) {
    const c = definition[i]!;
    if (quoted) {
      token += c;
      if (c === quoted) {
        if (definition[i + 1] === quoted) token += definition[++i];
        else quoted = "";
      }
    } else if (["'", '"', "`", "["].includes(c)) {
      quoted = c === "[" ? "]" : c;
      token += c;
    } else if (c === "(") {
      depth++;
      token += c;
    } else if (c === ")") {
      depth--;
      token += c;
    } else if (/\s/.test(c) && depth === 0) {
      if (token) tokens.push(token);
      token = "";
    } else token += c;
  }
  if (token) tokens.push(token);
  if (quoted || depth || /--|\/\*/.test(definition)) return undefined;
  const fixed: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]!.toLowerCase();
    if (i > 1 && word === "default" && tokens[i - 1]?.toLowerCase() !== "set") {
      if (++i >= tokens.length) return undefined;
    } else if (
      i > 1 &&
      word === "not" &&
      tokens[i + 1]?.toLowerCase() === "null"
    )
      i++;
    else if (i > 1 && word === "null" && tokens[i - 1]?.toLowerCase() !== "set")
      continue;
    else fixed.push(tokens[i]!);
  }
  return fixed.join(" ");
}
