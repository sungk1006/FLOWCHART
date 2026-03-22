export type DueReminderEmailPayload = {
  projectCode: string;
  phaseTitle: string;
  stepLabel: string;
  /** datetime-local 등 원문 */
  dueDateRaw: string;
  /** 본문 표시용 */
  dueDisplay: string;
  assigneeName: string;
};

export function buildDueReminderEmailSubject(projectCode: string, stepLabel: string) {
  return `[FLOWCHART] [${projectCode}] Due Reminder - ${stepLabel}`;
}

export function buildDueReminderEmailBody(payload: DueReminderEmailPayload) {
  return [
    `프로젝트 코드: ${payload.projectCode}`,
    `Phase: ${payload.phaseTitle}`,
    `스텝: ${payload.stepLabel}`,
    `마감 시각: ${payload.dueDisplay}`,
    `담당자: ${payload.assigneeName}`,
    "",
    "위 스텝은 마감 24시간 전 구간에 들어왔습니다. 미완료 상태이니 일정을 확인해 주세요.",
  ].join("\n");
}

/** API 요청 바디 (클라이언트에서 전달) */
export type DueReminderProcessRequest = {
  projects: DueReminderProjectWire[];
  members: DueReminderMemberWire[];
};

export function buildDueReminderProcessRequest(
  projects: DueReminderProjectWire[],
  members: DueReminderMemberWire[]
): DueReminderProcessRequest {
  return {
    projects: projects.map((p) => ({
      id: p.id,
      code: p.code,
      phases: p.phases.map((ph) => ({
        id: ph.id,
        title: ph.title,
        steps: ph.steps.map((s) => ({
          id: s.id,
          label: s.label,
          checked: s.checked,
          dueDate: s.dueDate,
          assigneeMemberId: s.assigneeMemberId,
          dueReminderSentAt: s.dueReminderSentAt ?? "",
        })),
      })),
    })),
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
  };
}

export type DueReminderMemberWire = {
  id: string;
  name: string;
  email: string;
};

export type DueReminderStepWire = {
  id: string;
  label: string;
  checked: boolean;
  dueDate: string;
  assigneeMemberId: string;
  dueReminderSentAt: string;
};

export type DueReminderPhaseWire = {
  id: string;
  title: string;
  steps: DueReminderStepWire[];
};

export type DueReminderProjectWire = {
  id: string;
  code: string;
  phases: DueReminderPhaseWire[];
};

export type DueReminderJobResult = {
  projectId: string;
  phaseId: string;
  stepId: string;
  sentAt: string;
  ok: boolean;
  error?: string;
};

export type DueReminderProcessResponse = {
  mock: boolean;
  processed: DueReminderJobResult[];
};

const MS_24H = 24 * 60 * 60 * 1000;

export function parseDueTimeMs(value: string): number | null {
  if (!value?.trim()) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 마감 24시간 전 시각 ≤ 지금 < 마감 시각 */
export function isInDueReminderWindow(dueDateStr: string, nowMs: number): boolean {
  const dueMs = parseDueTimeMs(dueDateStr);
  if (dueMs === null) return false;
  if (nowMs < dueMs - MS_24H) return false;
  if (nowMs >= dueMs) return false;
  return true;
}

export function formatDueForEmail(dueDateStr: string): string {
  return dueDateStr.replace("T", " ");
}
