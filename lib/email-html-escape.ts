/** 메일 HTML 본문용 최소 이스케이프 */
export function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function nl2brEscaped(s: string): string {
  return escapeHtmlForEmail(s).replace(/\n/g, "<br/>");
}
