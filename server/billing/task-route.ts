export function taskClass(body: string): "format" | "reason" {
  const text = body.toLowerCase();
  const format = /\b(format|reformat|translate|summarize|summary|proofread|sort|list)\b/.test(text);
  const reason = /\b(why|decide|design|debug|investigate|compare|plan)\b/.test(text);
  return format && !reason ? "format" : "reason";
}

export function modelForBundledTask(body: string, formatModel: string, byo: boolean): string | null {
  if (byo || !formatModel) return null;
  return taskClass(body) === "format" ? formatModel : null;
}

export function rewriteModel(body: string, model: string): string {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  parsed.model = model;
  return JSON.stringify(parsed);
}
