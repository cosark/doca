import { z } from "zod";
import { fail } from "../../shared/errors.js";

// Native @smartdoca/sheet 0.2.3 / Univer IColorStyle. This validates new AI
// commands only; persisted cells and historical invalid fields are not rewritten.
export const spreadsheetColor = z.strictObject({
  rgb: z.string().min(1).nullable().optional(),
  th: z.number().int().optional(),
});

const misplacedColorFields = [
  "bgColor",
  "backgroundColor",
  "background",
  "color",
  "textColor",
  "fontColor",
  "fill",
];
const hint =
  '背景色使用 s:{bg:{rgb:"#FFCC00"}}，文字颜色使用 s:{cl:{rgb:"#333333"}}；本批次未保存，不自动转换错误字段';

export function validateSpreadsheetCellStyle(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const cell = input as Record<string, unknown>;
  const misplaced = [...misplacedColorFields, "bg", "cl", "style"].find(
    (key) => key in cell,
  );
  if (misplaced) fail(400, `单元格不支持 ${misplaced}。${hint}`);
  const style = cell.s;
  if (!style || typeof style !== "object" || Array.isArray(style)) return;
  const fields = style as Record<string, unknown>;
  const invalid = misplacedColorFields.find((key) => key in fields);
  if (invalid) fail(400, `单元格样式不支持 s.${invalid}。${hint}`);
  for (const key of ["bg", "cl"])
    if (
      fields[key] !== undefined &&
      fields[key] !== null &&
      !spreadsheetColor.safeParse(fields[key]).success
    )
      fail(400, `单元格样式 s.${key} 必须是原生颜色对象或 null。${hint}`);
}

export function validateSpreadsheetCellMatrix(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  for (const row of Object.values(input))
    if (row && typeof row === "object" && !Array.isArray(row))
      for (const cell of Object.values(row)) validateSpreadsheetCellStyle(cell);
}
