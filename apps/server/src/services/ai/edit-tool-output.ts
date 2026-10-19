import { isValidationError } from "@mastra/core/tools";

/** Explain the current SDK's array error without its misleading string-length hint. */
export function editToolModelOutput(output: any) {
  if (isValidationError(output)) {
    const fields = output.validationErrors as {
      fields?: Record<string, { errors?: string[] }>;
    };
    if (
      fields.fields?.operations?.errors?.some((error) =>
        error.includes("expected array"),
      )
    )
      return {
        type: "json" as const,
        value: {
          error: true,
          code: "edit_operations_array_required",
          message:
            'operations 必须直接传对象数组，例如 [{"type":"append","text":"正文"}]，不能传带引号的 JSON 字符串。',
          instruction:
            "80 限制的是操作数量，不是字符数。请检查整个工具 JSON 是否完整、引号及括号是否配对，再直接提供 operations 对象数组，保留已读取的 resourceId、seq、epochId。若是画布 createFlowchart，其 edges 数组结束后应依次关闭操作对象、operations 数组、最外层对象，不能多写一个 }；可先单独提交完整流程图，标题另次新增。不要对 operations 调用 JSON.stringify。尚未保存本批修改。",
        },
      };
  }
  return { type: "json" as const, value: output };
}
