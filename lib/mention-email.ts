import { escapeHtmlForEmail, nl2brEscaped } from "@/lib/email-html-escape";

export type MentionEmailRecipient = {
  email: string;
  name: string;
};

export type MentionNotifyRequest = {
  recipients: MentionEmailRecipient[];
  projectCode: string;
  stepLabel: string;
  phaseTitle: string;
  authorName: string;
  commentText: string;
  createdAt: string;
  /** 클라이언트가 보낸 전체 URL (?project=&step=). 없으면 projectId+stepId+서버 베이스 URL로 조합 */
  stepLink?: string;
  /** stepLink 없을 때 서버에서 링크 복구용 */
  projectId?: string;
  stepId?: string;
};

export type MentionNotifyRecipientResult = {
  email: string;
  name: string;
  ok: boolean;
  error?: string;
};

export type MentionNotifyResponse = {
  mock: boolean;
  results: MentionNotifyRecipientResult[];
};

export function buildMentionEmailSubject(projectCode: string, stepLabel: string) {
  return `[FLOWCHART] [${projectCode}] 멘션 알림 - ${stepLabel}`;
}

export function buildMentionEmailBodyText(payload: MentionNotifyRequest): string {
  const lines = [
    `Project: ${payload.projectCode}`,
    `Phase: ${payload.phaseTitle}`,
    `Step: ${payload.stepLabel}`,
    `From: ${payload.authorName}`,
    `Time: ${payload.createdAt}`,
    "",
    "Comment:",
    payload.commentText,
  ];
  const link = payload.stepLink?.trim();
  if (link) {
    lines.push("", "Open this step in Flowchart:", link);
  }
  return lines.join("\n");
}

export function buildMentionEmailBodyHtml(payload: MentionNotifyRequest): string {
  const link = payload.stepLink?.trim();
  const commentBlock = nl2brEscaped(payload.commentText || "");
  const linkBlock = link
    ? (() => {
        const href = escapeHtmlForEmail(link);
        return `<p style="margin:20px 0 0;font-family:sans-serif;font-size:14px;">
  <a href="${href}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open this step in Flowchart</a>
</p>
<p style="margin:12px 0 0;font-family:sans-serif;font-size:12px;color:#64748b;word-break:break-all;">${href}</p>`;
      })()
    : "";
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;color:#0f172a;line-height:1.5;">
<p><strong>Project:</strong> ${escapeHtmlForEmail(payload.projectCode)}<br/>
<strong>Phase:</strong> ${escapeHtmlForEmail(payload.phaseTitle)}<br/>
<strong>Step:</strong> ${escapeHtmlForEmail(payload.stepLabel)}<br/>
<strong>From:</strong> ${escapeHtmlForEmail(payload.authorName)}<br/>
<strong>Time:</strong> ${escapeHtmlForEmail(payload.createdAt)}</p>
<p><strong>Comment:</strong></p>
<p style="margin:0 0 8px;">${commentBlock}</p>
${linkBlock}
</body></html>`;
}

/** 호환용 — plain text 본문 */
export function buildMentionEmailBody(payload: MentionNotifyRequest): string {
  return buildMentionEmailBodyText(payload);
}
