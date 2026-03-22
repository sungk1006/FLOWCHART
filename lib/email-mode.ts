/** MENTION_EMAIL_MODE=live 일 때 Resend 등 실제 발송 경로 사용 */
export function isEmailLiveMode() {
  return process.env.MENTION_EMAIL_MODE === "live";
}

export function isEmailMockMode() {
  return !isEmailLiveMode();
}
