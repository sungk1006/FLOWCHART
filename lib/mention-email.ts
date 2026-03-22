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

export function buildMentionEmailBody(payload: MentionNotifyRequest) {
  return [
    `Phase: ${payload.phaseTitle}`,
    `작성자: ${payload.authorName}`,
    `작성시간: ${payload.createdAt}`,
    "",
    "댓글:",
    payload.commentText,
  ].join("\n");
}
