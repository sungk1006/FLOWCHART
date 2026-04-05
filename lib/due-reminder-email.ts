import { escapeHtmlForEmail } from "@/lib/email-html-escape";

export type DueReminderOffset = "1" | "2" | "3";

/** 스텝별 D-3 / D-2 / D-1 발송 시각(ISO) */
export type DueReminderSentMap = Partial<Record<DueReminderOffset, string>>;

export type DueReminderEmailPayload = {
  projectCode: string;
  phaseTitle: string;
  stepLabel: string;
  /** datetime-local 등 원문 */
  dueDateRaw: string;
  /** 본문 표시용 */
  dueDisplay: string;
  assigneeName: string;
  /** D-3 / D-2 / D-1 */
  reminderLabel: string;
  /** ?project=&step= 형태 대시보드 딥링크 */
  stepLink?: string;
};

function parseDueDateStartLocal(dueDateStr: string): Date | null {
  if (!dueDateStr?.trim()) return null;
  const m = dueDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const date = new Date(y, mo, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDayFromMs(nowMs: number): Date {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 오늘 0시 기준 달력 일 수 차이 (마감일 당일 = 0) */
export function getCalendarDaysUntilDue(dueDateStr: string, nowMs: number): number | null {
  const dueStart = parseDueDateStartLocal(dueDateStr);
  if (!dueStart) return null;
  const todayStart = startOfLocalDayFromMs(nowMs);
  return Math.round((dueStart.getTime() - todayStart.getTime()) / 86400000);
}

/** 마감일 당일 23:59:59.999 지난 뒤 true (OVERDUE) */
export function isDueDateOverdue(dueDateStr: string, nowMs: number): boolean {
  const dueStart = parseDueDateStartLocal(dueDateStr);
  if (!dueStart) return false;
  const end = new Date(dueStart.getFullYear(), dueStart.getMonth(), dueStart.getDate(), 23, 59, 59, 999);
  return nowMs > end.getTime();
}

export function getDueSoonLabel(dueDateStr: string, nowMs: number): "D-3" | "D-2" | "D-1" | null {
  if (isDueDateOverdue(dueDateStr, nowMs)) return null;
  const days = getCalendarDaysUntilDue(dueDateStr, nowMs);
  if (days === 3) return "D-3";
  if (days === 2) return "D-2";
  if (days === 1) return "D-1";
  return null;
}

export function offsetToLabel(offset: DueReminderOffset): string {
  if (offset === "3") return "D-3";
  if (offset === "2") return "D-2";
  return "D-1";
}

export function buildDueReminderEmailSubject(projectCode: string, stepLabel: string, reminderLabel: string) {
  return `[FLOWCHART] [${projectCode}] ${reminderLabel} · ${stepLabel}`;
}

export function buildDueReminderEmailBody(payload: DueReminderEmailPayload): string {
  const lines = [
    `프로젝트 코드: ${payload.projectCode}`,
    `Phase: ${payload.phaseTitle}`,
    `스텝: ${payload.stepLabel}`,
    `마감 시각: ${payload.dueDisplay}`,
    `담당자: ${payload.assigneeName}`,
    "",
    `${payload.reminderLabel} 알림: 마감일이 가까운 미완료 스텝입니다. 일정을 확인해 주세요.`,
  ];
  if (payload.stepLink?.trim()) {
    lines.push("", "Open this step in Flowchart:", payload.stepLink.trim());
  }
  return lines.join("\n");
}

export function buildDueReminderEmailBodyHtml(payload: DueReminderEmailPayload): string {
  const link = payload.stepLink?.trim();
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
<p><strong>프로젝트 코드:</strong> ${escapeHtmlForEmail(payload.projectCode)}<br/>
<strong>Phase:</strong> ${escapeHtmlForEmail(payload.phaseTitle)}<br/>
<strong>스텝:</strong> ${escapeHtmlForEmail(payload.stepLabel)}<br/>
<strong>마감 시각:</strong> ${escapeHtmlForEmail(payload.dueDisplay)}<br/>
<strong>담당자:</strong> ${escapeHtmlForEmail(payload.assigneeName)}</p>
<p>${escapeHtmlForEmail(payload.reminderLabel)} 알림: 마감일이 가까운 미완료 스텝입니다. 일정을 확인해 주세요.</p>
${linkBlock}
</body></html>`;
}

/** API 요청 바디 (클라이언트에서 전달) */
export type DueReminderProcessRequest = {
  projects: DueReminderProjectWire[];
  members: DueReminderMemberWire[];
  /** origin + pathname, 쿼리 없음. 메일 본문 딥링크에 사용 */
  appBaseUrl?: string;
};

/** 클라이언트에서 하위 스텝(subSteps)을 넣을 때 사용 — API 전송 전 1depth로 평탄화 */
export type DueReminderStepWireInput = {
  id: string;
  label: string;
  checked: boolean;
  dueDate: string;
  assigneeMemberIds: string[];
  dueReminderSentMap?: DueReminderSentMap;
  subSteps?: DueReminderStepWireInput[];
};

export type DueReminderPhaseWireInput = {
  id: string;
  title: string;
  steps: DueReminderStepWireInput[];
};

export type DueReminderProjectWireInput = {
  id: string;
  code: string;
  phases: DueReminderPhaseWireInput[];
};

function flattenDueReminderStepInputs(steps: DueReminderStepWireInput[]): DueReminderStepWire[] {
  const out: DueReminderStepWire[] = [];
  function walk(list: DueReminderStepWireInput[]) {
    for (const s of list) {
      const { subSteps, ...rest } = s;
      out.push({
        id: rest.id,
        label: rest.label,
        checked: rest.checked,
        dueDate: rest.dueDate,
        assigneeMemberIds: rest.assigneeMemberIds ?? [],
        dueReminderSentMap: rest.dueReminderSentMap ?? {},
      });
      if (subSteps?.length) walk(subSteps);
    }
  }
  walk(steps);
  return out;
}

export function buildDueReminderProcessRequest(
  projects: DueReminderProjectWireInput[],
  members: DueReminderMemberWire[],
  appBaseUrl?: string
): DueReminderProcessRequest {
  return {
    ...(appBaseUrl?.trim() ? { appBaseUrl: appBaseUrl.trim() } : {}),
    projects: projects.map((p) => ({
      id: p.id,
      code: p.code,
      phases: p.phases.map((ph) => ({
        id: ph.id,
        title: ph.title,
        steps: flattenDueReminderStepInputs(ph.steps),
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
  assigneeMemberIds: string[];
  dueReminderSentMap: DueReminderSentMap;
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
  reminderOffset: DueReminderOffset;
  sentAt: string;
  ok: boolean;
  error?: string;
  /** 다중 담당자 발송 시 로그 매칭용 */
  recipientMemberId?: string;
};

export type DueReminderProcessResponse = {
  mock: boolean;
  processed: DueReminderJobResult[];
};

export function formatDueForEmail(dueDateStr: string): string {
  return dueDateStr.replace("T", " ");
}

export function normalizeDueReminderSentMapFromWire(raw: unknown): DueReminderSentMap {
  const out: DueReminderSentMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const k of ["1", "2", "3"] as DueReminderOffset[]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}
