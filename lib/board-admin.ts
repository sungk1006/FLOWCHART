/** 보드 관리자(고정 이메일). members.role === "관리자" 와 함께 사용 */
export const BOARD_ADMIN_EMAIL = "sungkyung@elcafetal.co.kr";

export function normalizeBoardEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isBoardAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return normalizeBoardEmail(email) === BOARD_ADMIN_EMAIL;
}

export function roleForBoardMemberEmail(email: string): "관리자" | "사용자" {
  return isBoardAdminEmail(email) ? "관리자" : "사용자";
}
