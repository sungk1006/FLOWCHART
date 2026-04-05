"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildDueReminderProcessRequest,
  type DueReminderJobResult,
  type DueReminderProcessResponse,
  type DueReminderStepWireInput,
} from "@/lib/due-reminder-email";
import { buildFlowchartStepLink } from "@/lib/flowchart-step-link";
import { type MentionNotifyResponse } from "@/lib/mention-email";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { FLOWCHART_LEGACY_STORAGE_KEY, getFlowchartShareId, isSupabaseDashboardEnabled } from "@/lib/sync/constants";
import { deleteBoardMemberAsAdmin } from "@/app/actions/delete-board-member";
import { ensureBoardMemberForCurrentUser } from "@/app/actions/ensure-board-member";
import { touchBoardMemberHeartbeat } from "@/app/actions/heartbeat-board-member";
import { isBoardAdminEmail } from "@/lib/board-admin";
import { isMemberOnline } from "@/lib/members-online";
import {
  loadMembersOnly,
  loadProjectsOnly,
  rowToProject,
  syncProjectsOnly,
  type MemberRow,
  type ProjectRow,
} from "@/lib/sync/dashboard";
import { CreatableSelect } from "@/components/project-dashboard/CreatableSelect";
import { OptionManageModal } from "@/components/project-dashboard/OptionManageModal";
import {
  addOptionToList,
  applyProjectFilters,
  countOptionUsage,
  defaultProjectFilters,
  emptySelectOptions,
  mergeSelectOptionsWithProjects,
  removeOptionFromList,
  type ProjectFilters,
  type SelectOptionFieldKey,
  type SelectOptions,
} from "@/lib/project-dashboard-core";

type ProjectStatus = "REVIEW" | "IN PROGRESS" | "HOLD" | "DONE" | "DRAFT";

type OverviewSortOption = "CODE_ASC" | "CODE_DESC" | "UPDATED_DESC" | "PROGRESS_DESC";
type MemberRole = "관리자" | "사용자";

type Member = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  /** Supabase Auth 사용자 id */
  userId?: string | null;
  /** members.last_seen_at (DB 동기화 시) */
  lastSeenAt?: string | null;
};

function mapMemberRowToPageMember(row: MemberRow): Member {
  const role: MemberRole = row.role === "관리자" ? "관리자" : "사용자";
  const m: Member = {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    lastSeenAt: row.last_seen_at ?? null,
  };
  if (row.user_id != null) {
    m.userId = row.user_id;
  }
  return m;
}

type Mention = {
  memberId: string;
  name: string;
  email: string;
};

type StepComment = {
  id: string;
  authorName: string;
  message: string;
  mentions: Mention[];
  createdAt: string;
};

type NotificationLogEmailRecipient = {
  email: string;
  name: string;
  ok: boolean;
  error?: string;
};

type NotificationLog = {
  id: string;
  /** 생략 시 멘션 로그(기존 데이터 호환) */
  kind?: "mention" | "due_reminder";
  projectCode: string;
  phaseTitle: string;
  stepLabel: string;
  authorName: string;
  commentText: string;
  /** 대시보드 해당 스텝 딥링크 (?project=&step=) */
  stepLink?: string;
  recipients: Mention[];
  createdAt: string;
  /** 멘션 메일 발송 시도 결과 (멘션이 없으면 생략) */
  emailNotify?: {
    attemptedAt: string;
    mock: boolean;
    overallOk: boolean;
    overallError?: string;
    perRecipient: NotificationLogEmailRecipient[];
  };
};

type Step = {
  id: string;
  label: string;
  checked: boolean;
  /** 해당 없음 → 자동 완료(checked) 처리 */
  notApplicable: boolean;
  dueDate: string;
  /** 마감 24시간 전 알림 발송 시각(ISO). 비어 있으면 미발송 */
  dueReminderSentAt: string;
  confirmedAt: string;
  memo: string;
  assigneeMemberIds: string[];
  comments: StepComment[];
  /** 하위 스텝이 있을 때만 — 플로우차트에서 펼침 여부 */
  expanded?: boolean;
  subSteps?: Step[];
};

type StepEditorDraft = {
  dueDate: string;
  confirmedAt: string;
  memo: string;
  assigneeMemberIds: string[];
};

type Phase = {
  id: string;
  title: string;
  expanded: boolean;
  steps: Step[];
};

type Project = {
  id: string;
  code: string;
  status: ProjectStatus;
  country: string;
  certificate: string;
  exporter: string;
  item: string;
  client: string;
  businessModel: string;
  incoterms: string;
  hsCode: string;
  customRate: string;
  vatRate: string;

  etd: string;
  eta: string;

  priceValue: string;
  priceCurrency: "USD" | "KRW";
  priceUnit: "KG" | "LB" | "UNIT";
  offerPriceValue: string;
  offerPriceCurrency: "USD" | "KRW";
  offerPriceUnit: "KG" | "LB" | "UNIT";
  finalPriceValue: string;
  finalPriceCurrency: "USD" | "KRW";
  finalPriceUnit: "KG" | "LB" | "UNIT";
  note: string;
  updated: boolean;
  lastChangedAt: string;
  phases: Phase[];
  notificationLogs: NotificationLog[];
};

type ProjectHeaderDraft = {
  code: string;
  status: ProjectStatus;
  country: string;
  certificate: string;
  businessModel: string;
  incoterms: string;
  exporter: string;
  client: string;
  item: string;
  hsCode: string;
  customRate: string;
  vatRate: string;

  etd: string;
  eta: string;

  priceValue: string;
  priceCurrency: "USD" | "KRW";
  priceUnit: "KG" | "LB" | "UNIT";
  offerPriceValue: string;
  offerPriceCurrency: "USD" | "KRW";
  offerPriceUnit: "KG" | "LB" | "UNIT";
  finalPriceValue: string;
  finalPriceCurrency: "USD" | "KRW";
  finalPriceUnit: "KG" | "LB" | "UNIT";
};

type PersistedState = {
  projects: Project[];
  selectedId: string;
  globalMembers: Member[];
  sidebarFilters?: ProjectFilters;
  detailFilters?: ProjectFilters;
  sidebarSearch?: string;
  detailSearch?: string;
  /** @deprecated 호환용 — 없으면 무시 */
  projectFilters?: ProjectFilters;
  selectOptions?: SelectOptions;
};

function parsePersistedJson(raw: string): Partial<PersistedState> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as Partial<PersistedState>;
  } catch {
    return null;
  }
}

function normalizeStoredMembers(raw: unknown): Member[] {
  if (!Array.isArray(raw)) return [];
  const out: Member[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    const roleRaw = o.role;
    const role: MemberRole =
      roleRaw === "관리자" ? "관리자" : roleRaw === "사용자" ? "사용자" : "사용자";

    const name = typeof o.name === "string" ? o.name : o.name == null ? "" : String(o.name);
    const email = typeof o.email === "string" ? o.email : o.email == null ? "" : String(o.email);

    let normalizedUserId: string | null | undefined;
    if (!Object.prototype.hasOwnProperty.call(o, "userId") && !Object.prototype.hasOwnProperty.call(o, "user_id")) {
      normalizedUserId = undefined;
    } else {
      const rawUid = Object.prototype.hasOwnProperty.call(o, "userId") ? o.userId : o.user_id;
      if (rawUid === undefined) {
        normalizedUserId = undefined;
      } else if (rawUid === null) {
        normalizedUserId = null;
      } else if (typeof rawUid === "string") {
        normalizedUserId = rawUid.length > 0 ? rawUid : null;
      } else {
        normalizedUserId = null;
      }
    }

    const member: Member = {
      id: o.id,
      name,
      email,
      role,
    };
    if (normalizedUserId !== undefined) {
      member.userId = normalizedUserId;
    }
    out.push(member);
  }
  return out;
}

function normalizeStoredProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const out: Project[] = [];
  for (const item of raw) {
    try {
      out.push(projectFromStorage(item));
    } catch {
      // 손상된 프로젝트 한 건은 건너뜀
    }
  }
  return out;
}

function createId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function nowString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalDate(value: string) {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const date = new Date(y, mo, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function isOverdue(value: string) {
  const d = parseLocalDate(value);
  if (!d) return false;
  return endOfLocalDay(d).getTime() < Date.now();
}

function getDaysUntilDue(value: string) {
  const d = parseLocalDate(value);
  if (!d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function getDueSoonLabel(value: string) {
  const days = getDaysUntilDue(value);
  if (days == null) return null;
  if (days >= 1 && days <= 3) return `D-${days}`;
  return null;
}

function normalizeDateOnly(value: string) {
  if (!value) return "";
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : "";
}

function stepToDraft(step: Step): StepEditorDraft {
  return {
    dueDate: step.dueDate,
    confirmedAt: step.confirmedAt,
    memo: step.memo,
    assigneeMemberIds: [...step.assigneeMemberIds],
  };
}

function idSetsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function extractMentionsFromText(text: string, members: Member[]): Mention[] {
  return members
    .filter((member) => text.includes(`@${member.name}`))
    .map((member) => ({
      memberId: member.id,
      name: member.name,
      email: member.email,
    }));
}

function buildNotificationRecipients(memo: string, assigneeMemberIds: string[], members: Member[]): Mention[] {
  const mentionRecipients = extractMentionsFromText(memo, members);
  const assigneeRecipients = assigneeMemberIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m))
    .map((m) => ({
      memberId: m.id,
      name: m.name,
      email: m.email,
    }));

  const merged = [...mentionRecipients, ...assigneeRecipients];
  const seen = new Set<string>();
  return merged.filter((r) => {
    const key = (r.memberId || r.email || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAssigneeSummary(members: Member[], ids: string[]): string {
  if (!ids.length) return "미지정";
  const names = ids
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter((n): n is string => Boolean(n?.trim()));
  if (!names.length) return "미지정";
  if (names.length === 1) return names[0]!;
  return `${names[0]!} 외 ${names.length - 1}명`;
}

function createStep(label: string): Step {
  return {
    id: createId("step"),
    label,
    checked: false,
    notApplicable: false,
    dueDate: "",
    dueReminderSentAt: "",
    confirmedAt: "",
    memo: "",
    assigneeMemberIds: [],
    comments: [],
  };
}

const NEW_PRODUCT_SUB_LABELS = [
  "1-1 SPEC",
  "1-2 INGREDIENT LIST",
  "1-3 NUTRITIONAL FACT",
  "1-4 FLOW CHART",
  "1-5 MOQ",
  "1-6 PACKING UNIT",
  "1-7 Palletlizing",
  "1-8 Storage",
] as const;

const IMPORT_AVAILABILITY_SUB_LABELS = [
  "2-1 국내실적 확인",
  "2-2 인증정보 확인",
  "2-3 해외 제조업소 등록여부 체크",
] as const;

const PRICING_SUB_LABELS = [
  "3-1 수출자 오퍼가격 확인",
  "3-2 ORDER PRICE 체크",
  "3-3 CLIENT 오퍼가격 확인",
] as const;

const OVERSEAS_ORDER_SUB_LABELS = [
  "4-1 PO",
  "4-2 선입금",
  "4-3 수입/수입대행계약서",
] as const;

const PSS_TEST_SUB_LABELS = [
  "5-1 샘플요청",
  "5-2 통관요청",
  "5-3 샘플수령",
  "5-4 샘플테스트",
  "5-5 결과전달",
] as const;

const PACKING_LABEL_SUB_LABELS = [
  "6-1 packing 디자인 확인",
  "6-2 영어라벨 확인",
  "6-3 한글라벨 확인",
  "6-4 부착사진 확인",
] as const;

const BOOKING_SUB_LABELS = [
  "7-1 선사 운임 요청",
  "7-2 SC 확인 및 전달",
  "7-3 BOOKING CONFIRMATION",
  "7-4 L/C",
] as const;

const SHIPPING_DOCUMENT_SUB_LABELS = [
  "8-1 BL",
  "8-2 INVOICE",
  "8-3 PACKING LIST",
  "8-4 COO",
  "8-5 CO",
  "8-6 ICO",
  "8-7 COA",
  "8-8 QUALITY CERTIFICATE",
  "8-9 TC",
  "8-10 PESTICIDE RESIDUE",
  "8-11 OCHRATOXIN",
  "8-12 AFLATOXIN",
  "8-13 INSURANCE",
] as const;

const PAYMENT_SUB_LABELS = [
  "9-1 선입금",
  "9-2 CP",
  "9-3 송금",
] as const;

const ARRIVAL_SUB_LABELS = [
  "10-1 운임인보이스",
  "10-2 DO",
  "10-3 FREE TIME",
  "10-4 검색기",
  "10-5 디탠션",
  "10-6 디머리지",
] as const;

const INSPECTION_TRANSPORT_SUB_LABELS = [
  "11-1 보세운송",
  "11-2 검역",
] as const;

const CUSTOMS_CLEARANCE_SUB_LABELS = [
  "12-1 수입신고견본확인",
  "12-2 통관비용 청구서 확인 및 통관비 입금",
  "12-3 통관요청 및 통관확인",
  "12-4 통관서류 확인",
] as const;

const WAREHOUSING_SUB_LABELS = [
  "13-1 입고일정 및 입고지 확인",
  "13-2 입고",
] as const;

const FEEDBACK_NEXT_ORDER_SUB_LABELS = [
  "15-1 클레임 확인",
  "15-2 수출업체 클레임 요청",
  "15-3 피드백 전달",
  "15-4 다음 오더일 체크",
] as const;

function createParentStep(label: string, subLabels: readonly string[]): Step {
  return {
    ...createStep(label),
    expanded: false,
    subSteps: subLabels.map((subLabel) => createStep(subLabel)),
  };
}

function flattenStepsDeep(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    out.push(s);
    if (s.subSteps?.length) out.push(...flattenStepsDeep(s.subSteps));
  }
  return out;
}

function areAllNestedChildrenComplete(step: Step): boolean {
  if (!step.subSteps?.length) return true;
  return step.subSteps.every((sub) => {
    const selfDone = sub.checked || sub.notApplicable;
    return selfDone && areAllNestedChildrenComplete(sub);
  });
}

function reconcileParentCheckFromChildren(step: Step): Step {
  if (!step.subSteps?.length) return step;

  const nextSubSteps = step.subSteps.map(reconcileParentCheckFromChildren);
  const allDone = nextSubSteps.every(
    (sub) => (sub.checked || sub.notApplicable) && areAllNestedChildrenComplete(sub)
  );

  const nextChecked = step.notApplicable ? true : allDone;
  const nextConfirmedAt = nextChecked
    ? step.confirmedAt?.trim()
      ? step.confirmedAt
      : todayLocalDate()
    : "";

  return {
    ...step,
    subSteps: nextSubSteps,
    checked: nextChecked,
    confirmedAt: nextConfirmedAt,
  };
}

function reconcilePhaseSteps(steps: Step[]): Step[] {
  return steps.map(reconcileParentCheckFromChildren);
}

function autoCheckStepByLabelInTree(
  steps: Step[],
  targetLabel: string,
  confirmedAtValue: string
): Step[] {
  return steps.map((step) => {
    let next = step;

    if (step.label === targetLabel && !step.checked) {
      next = {
        ...step,
        checked: true,
        confirmedAt: step.confirmedAt?.trim() ? step.confirmedAt : confirmedAtValue,
        dueReminderSentAt: "",
      };
    }

    if (next.subSteps?.length) {
      return {
        ...next,
        subSteps: autoCheckStepByLabelInTree(next.subSteps, targetLabel, confirmedAtValue),
      };
    }

    return next;
  });
}

function autoCheckProjectStepByLabel(
  project: Project,
  targetLabel: string,
  confirmedAtValue: string,
  timestamp: string
): Project {
  let touched = false;

  const nextPhases = project.phases.map((phase) => {
    let phaseTouched = false;

    const nextSteps = reconcilePhaseSteps(
      autoCheckStepByLabelInTree(phase.steps, targetLabel, confirmedAtValue).map((step, index) => {
        const prevStep = phase.steps[index];
        if (step !== prevStep) {
          phaseTouched = true;
        }
        return step;
      })
    );

    if (phaseTouched) {
      touched = true;
      return { ...phase, steps: nextSteps };
    }

    return phase;
  });

  if (!touched) return project;

  return {
    ...project,
    phases: nextPhases,
    updated: true,
    lastChangedAt: timestamp,
  };
}

function forEachStepInTree(steps: Step[], fn: (s: Step) => void) {
  for (const s of steps) {
    fn(s);
    if (s.subSteps?.length) forEachStepInTree(s.subSteps, fn);
  }
}

function stepIdExistsInSteps(steps: Step[], stepId: string): boolean {
  for (const s of steps) {
    if (s.id === stepId) return true;
    if (s.subSteps?.length && stepIdExistsInSteps(s.subSteps, stepId)) return true;
  }
  return false;
}

function findStepInPhaseSteps(steps: Step[], stepId: string): Step | undefined {
  for (const s of steps) {
    if (s.id === stepId) return s;
    if (s.subSteps?.length) {
      const f = findStepInPhaseSteps(s.subSteps, stepId);
      if (f) return f;
    }
  }
  return undefined;
}

function patchStepInTree(steps: Step[], stepId: string, patcher: (s: Step) => Step): Step[] {
  return steps.map((step) => {
    if (step.id === stepId) return patcher(step);
    if (step.subSteps?.length) {
      return { ...step, subSteps: patchStepInTree(step.subSteps, stepId, patcher) };
    }
    return step;
  });
}

function removeMemberFromStepTree(step: Step, memberId: string): Step {
  const next: Step = {
    ...step,
    assigneeMemberIds: step.assigneeMemberIds.filter((id) => id !== memberId),
  };
  if (!step.subSteps?.length) return next;
  return { ...next, subSteps: step.subSteps.map((s) => removeMemberFromStepTree(s, memberId)) };
}

function stepToDueReminderInput(s: Step): DueReminderStepWireInput {
  return {
    id: s.id,
    label: s.label,
    checked: s.checked,
    dueDate: s.dueDate,
    assigneeMemberIds: s.assigneeMemberIds,
    dueReminderSentMap: {},
    subSteps: s.subSteps?.map(stepToDueReminderInput),
  };
}

type FlowchartVisibleRow = {
  phaseId: string;
  step: Step;
  depth: number;
  /** depth 0일 때 전체 플로우차트 기준으로 증가하는 메인 단계 번호 */
  mainIndex: number;
  isChildRow: boolean;
  /** 메인 행만 "1","2",… — 하위 행은 빈 문자열(라벨에 1-1 등이 있음) */
  displayIndex: string;
};

function buildPhaseVisibleRows(
  phase: Phase,
  startMainIndex: number
): { rows: FlowchartVisibleRow[]; nextMainIndex: number } {
  const rows: FlowchartVisibleRow[] = [];
  let mainCounter = startMainIndex;

  function walk(list: Step[], depth: number) {
    for (const step of list) {
      if (depth === 0) {
        mainCounter += 1;
        rows.push({
          phaseId: phase.id,
          step,
          depth,
          mainIndex: mainCounter,
          isChildRow: false,
          displayIndex: String(mainCounter),
        });
      } else {
        rows.push({
          phaseId: phase.id,
          step,
          depth,
          mainIndex: mainCounter,
          isChildRow: true,
          displayIndex: "",
        });
      }

      if (step.subSteps?.length && step.expanded) {
        walk(step.subSteps, depth + 1);
      }
    }
  }

  walk(phase.steps, 0);

  return {
    rows,
    nextMainIndex: mainCounter,
  };
}

function buildAllFlowchartVisibleRows(phases: Phase[]): FlowchartVisibleRow[] {
  const out: FlowchartVisibleRow[] = [];
  let cursor = 0;

  for (const phase of phases) {
    const built = buildPhaseVisibleRows(phase, cursor);
    out.push(...built.rows);
    cursor = built.nextMainIndex;
  }

  return out;
}

function createFixedFlowchartPhases(): Phase[] {
  return [
    {
      id: createId("phase"),
      title: "PHASE 1 — Planning",
      expanded: false,
      steps: [
        createParentStep("NEW PRODUCT", NEW_PRODUCT_SUB_LABELS),
        createParentStep("Import Availability", IMPORT_AVAILABILITY_SUB_LABELS),
        createParentStep("Pricing", PRICING_SUB_LABELS),
      ],
    },
    {
      id: createId("phase"),
      title: "PHASE 2 — Ordering",
      expanded: false,
      steps: [
        createParentStep("Overseas Order", OVERSEAS_ORDER_SUB_LABELS),
        createParentStep("PSS Test", PSS_TEST_SUB_LABELS),
        createParentStep("Packing & Label", PACKING_LABEL_SUB_LABELS),
      ],
    },
    {
      id: createId("phase"),
      title: "PHASE 3 — Shipping",
      expanded: false,
      steps: [
        createParentStep("Booking", BOOKING_SUB_LABELS),
        createParentStep("Shipping Document", SHIPPING_DOCUMENT_SUB_LABELS),
        createParentStep("Payment", PAYMENT_SUB_LABELS),
      ],
    },
    {
      id: createId("phase"),
      title: "PHASE 4 — Clearance",
      expanded: false,
      steps: [
        createParentStep("Arrival", ARRIVAL_SUB_LABELS),
        createParentStep("Inspection / container Transport", INSPECTION_TRANSPORT_SUB_LABELS),
        createParentStep("Customs Clearance", CUSTOMS_CLEARANCE_SUB_LABELS),
      ],
    },
    {
      id: createId("phase"),
      title: "PHASE 5 — Closing",
      expanded: false,
      steps: [
        createParentStep("Warehousing", WAREHOUSING_SUB_LABELS),
        createStep("Settlement"),
        createParentStep("Feedback / Next Order Plan", FEEDBACK_NEXT_ORDER_SUB_LABELS),
      ],
    },
  ];
}

/** 저장본에 남아 있을 수 있는 레거시 필드 제거 후 Project로 복원 */
function projectFromStorage(raw: unknown): Project {
  const p = { ...(raw as Record<string, unknown>) };
  delete p.projectMemberIds;
  return makeProject(p as Partial<Project>);
}

function sanitizeAssigneesAgainstMembers(projects: Project[], validMemberIds: Set<string>): Project[] {
  function sanitizeStep(step: Step): Step {
    const base: Step = {
      ...step,
      assigneeMemberIds: step.assigneeMemberIds.filter((id) => validMemberIds.has(id)),
    };
    if (!step.subSteps?.length) return base;
    return { ...base, subSteps: step.subSteps.map((s) => sanitizeStep(s)) };
  }
  return projects.map((project) => ({
    ...project,
    phases: project.phases.map((phase) => ({
      ...phase,
      steps: phase.steps.map((step) => sanitizeStep(step)),
    })),
  }));
}

/** 저장본 "1. Business Model Check" 등에서 앞 번호·점·공백 제거 */
function stripLeadingStepNumberFromLabel(raw: string): string {
  return raw.replace(/^\d{1,2}\.\s*/, "").trim();
}

function normalizeStepFromStorage(step: Step): Step {
  const r = step as unknown as Record<string, unknown>;
  let assigneeMemberIds: string[] = [];
  const arr = r.assigneeMemberIds;
  if (Array.isArray(arr)) {
    assigneeMemberIds = arr
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  const legacy = r.assigneeMemberId;
  if (assigneeMemberIds.length === 0 && typeof legacy === "string" && legacy.trim()) {
    assigneeMemberIds = [legacy.trim()];
  }
  const commentsRaw = r.comments;
  const comments = Array.isArray(commentsRaw) ? (commentsRaw as StepComment[]) : [];
  let label = stripLeadingStepNumberFromLabel(String((step as Step).label ?? ""));
  if (label === "Invoice" || /^invoice$/i.test(label)) {
    label = "Settlement";
  }
  if (label === "Business Model Check") {
    label = "NEW PRODUCT";
  }
  if (label === "Inspection / Inland Transport") {
    label = "Inspection / container Transport";
  }

  const subsRaw = r.subSteps;
  let subSteps: Step[] | undefined;
  if (Array.isArray(subsRaw)) {
    subSteps = subsRaw.map((x) => normalizeStepFromStorage(x as Step));
  }
  const finalSubs = subSteps && subSteps.length > 0 ? subSteps : undefined;

  const s = step as Step;
  return {
    id: s.id,
    label,
    checked: Boolean(s.checked ?? false),
    notApplicable: Boolean(s.notApplicable ?? false),
    dueDate: normalizeDateOnly(String(s.dueDate ?? "")),
    confirmedAt: normalizeDateOnly(String(s.confirmedAt ?? "")),
    dueReminderSentAt: String(s.dueReminderSentAt ?? ""),
    memo: typeof s.memo === "string" ? s.memo : "",
    assigneeMemberIds,
    comments,
    expanded: finalSubs ? Boolean(s.expanded) : undefined,
    subSteps: finalSubs,
  };
}

function ensureDefaultSubStepsForMainLabel(step: Step): Step {
  const map: Record<string, readonly string[]> = {
    "NEW PRODUCT": NEW_PRODUCT_SUB_LABELS,
    "Import Availability": IMPORT_AVAILABILITY_SUB_LABELS,
    Pricing: PRICING_SUB_LABELS,
    "Overseas Order": OVERSEAS_ORDER_SUB_LABELS,
    "PSS Test": PSS_TEST_SUB_LABELS,
    "Packing & Label": PACKING_LABEL_SUB_LABELS,
    Booking: BOOKING_SUB_LABELS,
    "Shipping Document": SHIPPING_DOCUMENT_SUB_LABELS,
    Payment: PAYMENT_SUB_LABELS,
    Arrival: ARRIVAL_SUB_LABELS,
    "Inspection / container Transport": INSPECTION_TRANSPORT_SUB_LABELS,
    "Inspection / Inland Transport": INSPECTION_TRANSPORT_SUB_LABELS,
    "Customs Clearance": CUSTOMS_CLEARANCE_SUB_LABELS,
    Warehousing: WAREHOUSING_SUB_LABELS,
    "Feedback / Next Order Plan": FEEDBACK_NEXT_ORDER_SUB_LABELS,
  };

  const expected = map[step.label];
  if (!expected) return step;
  if (step.subSteps?.length) return step;

  return {
    ...step,
    expanded: false,
    subSteps: expected.map((lbl) => createStep(lbl)),
  };
}

function normalizePhasesFromStorage(phases: Phase[]): Phase[] {
  // Order-based renames (e.g. flatten index 13) are unsafe: deep preorder index tracks
  // substeps, so the Nth flattened node is not the Nth main row. Settlement belongs only
  // on the Closing phase leaf from createFixedFlowchartPhases; legacy "Invoice" →
  // "Settlement" is handled in normalizeStepFromStorage per step.
  return phases.map((phase) => ({
    ...phase,
    steps: reconcilePhaseSteps(
      phase.steps.map((step) => ensureDefaultSubStepsForMainLabel(normalizeStepFromStorage(step)))
    ),
  }));
}

function buildFlowchartStepDeepLink(projectId: string, stepId: string): string {
  if (typeof window === "undefined") return "";
  return buildFlowchartStepLink(`${window.location.origin}${window.location.pathname}`, projectId, stepId);
}

function makeProject(data?: Partial<Project & { dutyRate?: string }>): Project {
  const raw = data as (Partial<Project> & { dutyRate?: string }) | undefined;
  const rawPhases = data?.phases ?? createFixedFlowchartPhases();
  const pc = raw?.priceCurrency;
  const oc = raw?.offerPriceCurrency;
  const fc = raw?.finalPriceCurrency;
  const pu = raw?.priceUnit;
  const ou = raw?.offerPriceUnit;
  const fu = raw?.finalPriceUnit;
  return {
    id: data?.id ?? createId("project"),
    code: data?.code ?? "DRAFT",
    status: data?.status ?? "DRAFT",
    country: data?.country ?? "",
    certificate: data?.certificate ?? "",
    exporter: data?.exporter ?? "",
    item: data?.item ?? "GREEN BEAN",
    client: data?.client ?? "",
    businessModel: data?.businessModel ?? "",
    incoterms: data?.incoterms ?? "",
    hsCode: data?.hsCode ?? "",
    customRate: raw?.customRate ?? raw?.dutyRate ?? "",
    vatRate: data?.vatRate ?? "",
    etd: data?.etd ?? "",
    eta: data?.eta ?? "",
    priceValue: data?.priceValue ?? "",
    priceCurrency: pc === "KRW" ? "KRW" : "USD",
    priceUnit: pu === "LB" || pu === "UNIT" ? pu : "KG",
    offerPriceValue: data?.offerPriceValue ?? "",
    offerPriceCurrency: oc === "KRW" ? "KRW" : "USD",
    offerPriceUnit: ou === "LB" || ou === "UNIT" ? ou : "KG",
    finalPriceValue: data?.finalPriceValue ?? "",
    finalPriceCurrency: fc === "KRW" ? "KRW" : "USD",
    finalPriceUnit: fu === "LB" || fu === "UNIT" ? fu : "KG",
    note: data?.note ?? "",
    updated: data?.updated ?? true,
    lastChangedAt: data?.lastChangedAt ?? nowString(),
    phases: normalizePhasesFromStorage(rawPhases),
    notificationLogs: data?.notificationLogs ?? [],
  };
}

const initialProjects: Project[] = [
  makeProject({
    code: "DRAFT",
    note: "여기서 직접 수정 시작",
  }),
];

function getProjectProgress(project: Project) {
  const mainSteps = project.phases.flatMap((phase) => phase.steps);
  const total = mainSteps.length;
  const done = mainSteps.filter((step) => step.checked).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function getNextDueStep(project: Project) {
  const steps = project.phases.flatMap((phase) =>
    flattenStepsDeep(phase.steps)
      .filter((step) => !step.checked && step.dueDate)
      .map((step) => ({
        phaseTitle: phase.title,
        ...step,
      }))
  );

  if (!steps.length) return null;

  return steps.sort((a, b) => {
    const aTime = parseLocalDate(a.dueDate)?.getTime() ?? Infinity;
    const bTime = parseLocalDate(b.dueDate)?.getTime() ?? Infinity;
    return aTime - bTime;
  })[0];
}

function getOverdueCount(project: Project) {
  return project.phases
    .flatMap((phase) => flattenStepsDeep(phase.steps))
    .filter((step) => !step.checked && step.dueDate && isOverdue(step.dueDate)).length;
}

function ProjectProgressRow({ project }: { project: Project }) {
  const pr = getProjectProgress(project);
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-600">
        <span>
          {pr.done}/{pr.total}
        </span>
        <span>{pr.percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-900" style={{ width: `${pr.percent}%` }} />
      </div>
    </div>
  );
}

function itemPillStyle(item: string) {
  if (item === "GREEN BEAN") return "bg-[#dfe9df] text-[#43624b]";
  if (item === "INSTANT COFFEE") return "bg-[#e8e1e5] text-[#4f4c4d]";
  if (item === "DECAF GREEN") return "bg-[#e8def4] text-[#6d558a]";
  if (item === "TEA EXTRACT") return "bg-[#dde8dc] text-[#496150]";
  if (item === "TEMPLATE") return "bg-[#ece2c6] text-[#7a6934]";
  return "bg-neutral-100 text-neutral-700";
}

const STATUS_FILTER_OPTIONS: ProjectStatus[] = ["REVIEW", "IN PROGRESS", "HOLD", "DONE", "DRAFT"];

type ExplorerStrField = "item" | "country" | "businessModel" | "incoterms" | "exporter" | "client";

const STR_FIELD_TO_OPTIONS_KEY: Record<ExplorerStrField, SelectOptionFieldKey> = {
  item: "items",
  country: "countries",
  businessModel: "businessModels",
  incoterms: "incoterms",
  exporter: "exporters",
  client: "clients",
};

function mergedChoicesForFilter(projects: Project[], selectOptions: SelectOptions, field: ExplorerStrField): string[] {
  const ok = STR_FIELD_TO_OPTIONS_KEY[field];
  const fromOpts = [...selectOptions[ok]];
  const fromProj = new Set<string>();
  for (const p of projects) {
    const raw =
      field === "item"
        ? p.item
        : field === "country"
          ? p.country
          : field === "businessModel"
            ? p.businessModel
            : field === "incoterms"
              ? p.incoterms
              : field === "exporter"
                ? p.exporter
                : p.client;
    const t = raw?.trim();
    if (t) fromProj.add(t);
  }
  return Array.from(new Set([...fromOpts, ...fromProj])).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function filterSummaryLabel(selected: string[]): string {
  if (selected.length === 0) return "ALL";
  if (selected.length === 1) return selected[0]!;
  return `${selected.length} selected`;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-[130px] flex-1 sm:max-w-[220px]">
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-sm"
      >
        <span className="truncate">{filterSummaryLabel(selected)}</span>
        <span className="shrink-0 text-neutral-400">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
          {options.length === 0 ? (
            <div className="px-2 py-2 text-xs text-neutral-400">옵션 없음</div>
          ) : (
            options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50"
              >
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => onToggle(opt)} />
                <span className="min-w-0 break-all">{opt}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusMultiDropdown({
  selected,
  onToggle,
}: {
  selected: ProjectStatus[];
  onToggle: (value: ProjectStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const selStr = selected as string[];

  return (
    <div ref={ref} className="relative min-w-[130px] flex-1 sm:max-w-[220px]">
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">STATUS</div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-sm"
      >
        <span className="truncate">{filterSummaryLabel(selStr)}</span>
        <span className="shrink-0 text-neutral-400">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
          {STATUS_FILTER_OPTIONS.map((st) => (
            <label
              key={st}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50"
            >
              <input type="checkbox" checked={selected.includes(st)} onChange={() => onToggle(st)} />
              <span>{st}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectExplorerFilterBar({
  projects,
  selectOptions,
  detailSearch,
  setDetailSearch,
  detailFilters,
  toggleDetailFilterValue,
  overviewSortBy,
  setOverviewSortBy,
}: {
  projects: Project[];
  selectOptions: SelectOptions;
  detailSearch: string;
  setDetailSearch: (v: string) => void;
  detailFilters: ProjectFilters;
  toggleDetailFilterValue: (field: keyof ProjectFilters, value: string | ProjectStatus) => void;
  overviewSortBy: OverviewSortOption;
  setOverviewSortBy: (v: OverviewSortOption) => void;
}) {
  const itemChoices = useMemo(() => mergedChoicesForFilter(projects, selectOptions, "item"), [projects, selectOptions]);
  const countryChoices = useMemo(() => mergedChoicesForFilter(projects, selectOptions, "country"), [projects, selectOptions]);
  const bmChoices = useMemo(
    () => mergedChoicesForFilter(projects, selectOptions, "businessModel"),
    [projects, selectOptions]
  );
  const incChoices = useMemo(() => mergedChoicesForFilter(projects, selectOptions, "incoterms"), [projects, selectOptions]);
  const expChoices = useMemo(() => mergedChoicesForFilter(projects, selectOptions, "exporter"), [projects, selectOptions]);
  const clientChoices = useMemo(() => mergedChoicesForFilter(projects, selectOptions, "client"), [projects, selectOptions]);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 sm:min-w-[240px]">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">Search</div>
          <input
            value={detailSearch}
            onChange={(e) => setDetailSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <MultiSelectDropdown
          label="ITEM"
          options={itemChoices}
          selected={detailFilters.item}
          onToggle={(v) => toggleDetailFilterValue("item", v)}
        />
        <MultiSelectDropdown
          label="COUNTRY"
          options={countryChoices}
          selected={detailFilters.country}
          onToggle={(v) => toggleDetailFilterValue("country", v)}
        />
        <MultiSelectDropdown
          label="BUSINESS MODEL"
          options={bmChoices}
          selected={detailFilters.businessModel}
          onToggle={(v) => toggleDetailFilterValue("businessModel", v)}
        />
        <MultiSelectDropdown
          label="INCOTERMS"
          options={incChoices}
          selected={detailFilters.incoterms}
          onToggle={(v) => toggleDetailFilterValue("incoterms", v)}
        />
        <MultiSelectDropdown
          label="EXPORTER"
          options={expChoices}
          selected={detailFilters.exporter}
          onToggle={(v) => toggleDetailFilterValue("exporter", v)}
        />
        <MultiSelectDropdown
          label="CLIENT"
          options={clientChoices}
          selected={detailFilters.client}
          onToggle={(v) => toggleDetailFilterValue("client", v)}
        />
        <StatusMultiDropdown
          selected={detailFilters.status}
          onToggle={(v) => toggleDetailFilterValue("status", v)}
        />
        <div className="min-w-[160px] flex-1 sm:max-w-[200px]">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">Sort</div>
          <select
            value={overviewSortBy}
            onChange={(e) => setOverviewSortBy(e.target.value as OverviewSortOption)}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="CODE_ASC">Code A–Z</option>
            <option value="CODE_DESC">Code Z–A</option>
            <option value="UPDATED_DESC">Recently updated</option>
            <option value="PROGRESS_DESC">Progress %</option>
          </select>
        </div>
      </div>
    </div>
  );
}

const SIDEBAR_ACCORDION_ROWS: { id: string; label: string; field: ExplorerStrField }[] = [
  { id: "item", label: "ITEM", field: "item" },
  { id: "country", label: "COUNTRY", field: "country" },
  { id: "businessModel", label: "BUSINESS MODEL", field: "businessModel" },
  { id: "incoterms", label: "INCOTERMS", field: "incoterms" },
  { id: "exporter", label: "EXPORTER", field: "exporter" },
  { id: "client", label: "CLIENT", field: "client" },
];

function SidebarFilterAccordion({
  projects,
  selectOptions,
  sidebarFilters,
  toggleSidebarFilterValue,
}: {
  projects: Project[];
  selectOptions: SelectOptions;
  sidebarFilters: ProjectFilters;
  toggleSidebarFilterValue: (field: keyof ProjectFilters, value: string | ProjectStatus) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {SIDEBAR_ACCORDION_ROWS.map((row) => {
        const choices = mergedChoicesForFilter(projects, selectOptions, row.field);
        const active = sidebarFilters[row.field] as string[];
        const header =
          active.length === 0 ? "ALL" : active.length === 1 ? active[0]! : `${active.length} selected`;
        const isOpen = openId === row.id;
        return (
          <div key={row.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <button
              type="button"
              onClick={() => setOpenId((prev) => (prev === row.id ? null : row.id))}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold"
            >
              <span>{row.label}</span>
              <span className="truncate text-[11px] font-normal text-neutral-500">{header}</span>
            </button>
            {isOpen ? (
              <div className="max-h-48 space-y-1 overflow-y-auto border-t border-neutral-100 px-2 py-2">
                {choices.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={active.includes(opt)}
                      onChange={() => toggleSidebarFilterValue(row.field, opt)}
                    />
                    <span className="min-w-0 break-all">{opt}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <button
          type="button"
          onClick={() => setOpenId((prev) => (prev === "status" ? null : "status"))}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold"
        >
          <span>STATUS</span>
          <span className="truncate text-[11px] font-normal text-neutral-500">
            {filterSummaryLabel(sidebarFilters.status as unknown as string[])}
          </span>
        </button>
        {openId === "status" ? (
          <div className="max-h-48 space-y-1 overflow-y-auto border-t border-neutral-100 px-2 py-2">
            {STATUS_FILTER_OPTIONS.map((st) => (
              <label
                key={st}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={sidebarFilters.status.includes(st)}
                  onChange={() => toggleSidebarFilterValue("status", st)}
                />
                <span>{st}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function PercentInputField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3">
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400"
      />
      <span className="shrink-0 text-[12px] font-medium text-neutral-500">%</span>
    </div>
  );
}

function PriceField({
  label,
  value,
  currency,
  unit,
  onValueChange,
  onCurrencyChange,
  onUnitChange,
  placeholder,
}: {
  label: string;
  value: string;
  currency: "USD" | "KRW";
  unit: "KG" | "LB" | "UNIT";
  onValueChange: (value: string) => void;
  onCurrencyChange: (value: "USD" | "KRW") => void;
  onUnitChange: (value: "KG" | "LB" | "UNIT") => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] gap-2">
        <input
          value={value ?? ""}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value as "USD" | "KRW")}
          className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-[12px] outline-none"
        >
          <option value="USD">USD</option>
          <option value="KRW">KRW</option>
        </select>
        <select
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as "KG" | "LB" | "UNIT")}
          className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-[12px] outline-none"
        >
          <option value="KG">KG</option>
          <option value="LB">LB</option>
          <option value="UNIT">UNIT</option>
        </select>
      </div>
    </Field>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <input
      value={value ?? ""}
      type={type}
      autoComplete="off"
      disabled={false}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={
        "w-full bg-transparent py-0.5 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 read-only:cursor-default disabled:opacity-100 " +
        className
      }
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      value={value ?? ""}
      rows={rows}
      autoComplete="off"
      disabled={false}
      readOnly={false}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={
        "w-full resize-none bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-100 " +
        className
      }
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent py-0.5 text-[13px] text-neutral-900 outline-none"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function MemberInitial({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
      {initial}
    </span>
  );
}

function renderMentions(message: string, mentions: Mention[]) {
  if (!mentions.length) return message;

  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  let parts: React.ReactNode[] = [message];

  sorted.forEach((mention) => {
    const nextParts: React.ReactNode[] = [];

    parts.forEach((part, index) => {
      if (typeof part !== "string") {
        nextParts.push(part);
        return;
      }

      const token = `@${mention.name}`;
      const split = part.split(token);

      split.forEach((chunk, chunkIndex) => {
        if (chunk) nextParts.push(chunk);
        if (chunkIndex < split.length - 1) {
          nextParts.push(
            <span
              key={`${mention.memberId}-${index}-${chunkIndex}`}
              className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700"
            >
              {token}
            </span>
          );
        }
      });
    });

    parts = nextParts;
  });

  return parts;
}

function extractMentionQuery(value: string) {
  const match = value.match(/@([^\s@]*)$/);
  return match ? match[1] : null;
}

function AssigneeMultiSelect({
  members,
  selectedIds,
  onChange,
  compact = false,
}: {
  members: Member[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? "flex w-full items-center justify-between gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-left text-[13px] text-neutral-900"
            : "flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-[14px] text-neutral-900"
        }
      >
        <span className="min-w-0 truncate">{buildAssigneeSummary(members, selectedIds)}</span>
        <span className="shrink-0 text-neutral-400">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
          {members.length === 0 ? (
            <div className="px-2 py-2 text-xs text-neutral-400">등록된 멤버가 없습니다.</div>
          ) : (
            members.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50"
              >
                <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggle(member.id)} />
                <span className="min-w-0 truncate">{member.name}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function applyDueReminderToStepTree(
  steps: Step[],
  sentAtByStep: Map<string, string>,
  projectId: string,
  phaseId: string,
  touchedRef: { v: boolean }
): Step[] {
  return steps.map((step) => {
    const key = `${projectId}\t${phaseId}\t${step.id}`;
    const sentAt = sentAtByStep.get(key);
    let next = step;
    if (sentAt && step.dueReminderSentAt !== sentAt) {
      touchedRef.v = true;
      next = { ...step, dueReminderSentAt: sentAt };
    }
    if (step.subSteps?.length) {
      return {
        ...next,
        subSteps: applyDueReminderToStepTree(step.subSteps, sentAtByStep, projectId, phaseId, touchedRef),
      };
    }
    return next;
  });
}

function applyDueReminderJobResults(prev: Project[], results: DueReminderJobResult[]): Project[] {
  const ok = results.filter((r) => r.ok && r.sentAt);
  if (!ok.length) return prev;
  const sentAtByStep = new Map<string, string>();
  for (const r of ok) {
    const key = `${r.projectId}\t${r.phaseId}\t${r.stepId}`;
    const prevSent = sentAtByStep.get(key);
    if (!prevSent || (r.sentAt && r.sentAt > prevSent)) {
      sentAtByStep.set(key, r.sentAt!);
    }
  }
  return prev.map((project) => {
    const touchedRef = { v: false };
    const phases = project.phases.map((phase) => ({
      ...phase,
      steps: applyDueReminderToStepTree(phase.steps, sentAtByStep, project.id, phase.id, touchedRef),
    }));
    return touchedRef.v
      ? { ...project, phases, updated: true, lastChangedAt: nowString() }
      : project;
  });
}

function dashboardDataFingerprint(projects: Project[]): string {
  const p = [...projects].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ projects: p });
}

/** 디버그: true면 fingerprint 같아도 setState 적용(평소 false 유지) */
const DEBUG_REALTIME_DISABLE_FINGERPRINT_SKIP = false;

/** public.projects / public.members 의 share_id(uuid) 와 Realtime filter 호환 여부 */
const SHARE_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function realtimePayloadShareId(payload: {
  new?: { share_id?: string };
  old?: { share_id?: string };
}): string | undefined {
  return payload.new?.share_id ?? payload.old?.share_id;
}

function realtimeEventMatchesShare(
  payload: { new?: { share_id?: string }; old?: { share_id?: string } },
  shareId: string
): boolean {
  return realtimePayloadShareId(payload) === shareId;
}

export default function Page() {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [selectedId, setSelectedId] = useState<string>(initialProjects[0]?.id ?? "");

  const [globalMembers, setGlobalMembers] = useState<Member[]>([]);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);

  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarFilters, setSidebarFilters] = useState<ProjectFilters>(() => defaultProjectFilters());
  const [detailSearch, setDetailSearch] = useState("");
  const [detailFilters, setDetailFilters] = useState<ProjectFilters>(() => defaultProjectFilters());
  const [selectOptions, setSelectOptions] = useState<SelectOptions>(() => emptySelectOptions());
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [allProjectsExpanded, setAllProjectsExpanded] = useState(false);
  const [overviewSortBy, setOverviewSortBy] = useState<OverviewSortOption>("CODE_ASC");
  const [optionManageField, setOptionManageField] = useState<SelectOptionFieldKey | null>(null);
  const [emailLogOpen, setEmailLogOpen] = useState(false);

  const [stepDrafts, setStepDrafts] = useState<Record<string, StepEditorDraft>>({});
  const [savingStepId, setSavingStepId] = useState<string | null>(null);
  const [dueReminderBusy, setDueReminderBusy] = useState(false);
  /** 첫 로드(Supabase 또는 레거시 localStorage) 완료 전에는 저장하지 않음 */
  const [storageReady, setStorageReady] = useState(false);
  /** URL ?step= 딥링크로 포커스된 행 강조 */
  const [highlightedStepId, setHighlightedStepId] = useState<string | null>(null);

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteFingerprintRef = useRef<string>("");
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const remoteProjectsLoadGenRef = useRef(0);
  /** 원격 프로젝트 병합·Realtime 시 assignee sanitize용 (멤버는 Supabase와 무관) */
  const localMembersSnapshotRef = useRef<Member[]>([]);
  const supabaseProjectsBootstrappedRef = useRef(false);
  const realtimeMembersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 병렬 loadMembersOnly 응답이 늦게 도착해 최신 멤버 목록을 덮어쓰지 않도록 함 */
  const membersRefreshSeqRef = useRef(0);

  const canDeleteMembers = useMemo(() => {
    if (isBoardAdminEmail(authUserEmail)) return true;
    if (
      authUserId &&
      globalMembers.some((m) => m.userId === authUserId && m.role === "관리자")
    ) {
      return true;
    }
    return false;
  }, [authUserEmail, authUserId, globalMembers]);

  const refreshMembersFromServer = useCallback(async () => {
    if (!isSupabaseDashboardEnabled() || !getFlowchartShareId()?.trim()) return;
    const seq = ++membersRefreshSeqRef.current;
    try {
      const { members } = await loadMembersOnly();
      if (seq !== membersRefreshSeqRef.current) return;
      const mapped = members.map(mapMemberRowToPageMember);
      setGlobalMembers(mapped);
      localMembersSnapshotRef.current = mapped;
    } catch (e) {
      console.error("[flowchart] loadMembersOnly failed", e);
    }
  }, []);

  useEffect(() => {
    localMembersSnapshotRef.current = globalMembers;
  }, [globalMembers]);

  useEffect(() => {
    if (!isSupabaseDashboardEnabled()) return;
    const sb = getSupabaseBrowserClient();
    let cancelled = false;

    void sb.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      setAuthUserId(user?.id ?? null);
      setAuthUserEmail(user?.email ?? null);
      if (!user) {
        window.location.href = "/login";
      }
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
      setAuthUserEmail(session?.user?.email ?? null);
      if (!session?.user) {
        window.location.href = "/login";
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const subscriptionShareId =
    storageReady && isSupabaseDashboardEnabled() ? getFlowchartShareId()?.trim() || null : null;

  useEffect(() => {
    if (!isSupabaseDashboardEnabled() || !getFlowchartShareId()?.trim() || !authUserId) return;

    let cancelled = false;

    async function heartbeat() {
      if (cancelled) return;
      const r = await touchBoardMemberHeartbeat();
      if (!r.ok) {
        console.error("[flowchart] touchBoardMemberHeartbeat", r);
      }
      await refreshMembersFromServer();
    }

    void heartbeat();
    const id = window.setInterval(() => void heartbeat(), 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [authUserId, storageReady, refreshMembersFromServer]);

  useEffect(() => {
    let cancelled = false;
    let hydratedMembers: Member[] = [];

    try {
      const raw = localStorage.getItem(FLOWCHART_LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = parsePersistedJson(raw);
        if (parsed) {
          if (parsed.globalMembers != null && !isSupabaseDashboardEnabled()) {
            hydratedMembers = normalizeStoredMembers(parsed.globalMembers);
            if (!cancelled) {
              setGlobalMembers(hydratedMembers);
              localMembersSnapshotRef.current = hydratedMembers;
            }
          }
          if (Array.isArray(parsed.projects)) {
            const restored = normalizeStoredProjects(parsed.projects);
            const memberIds = new Set(hydratedMembers.map((m) => m.id));
            const next = sanitizeAssigneesAgainstMembers(restored, memberIds);
            if (!cancelled && next.length > 0) {
              setProjects(next);
              const ids = new Set(next.map((p) => p.id));
              const rawSid = parsed.selectedId;
              const sid =
                next.length === 0
                  ? ""
                  : typeof rawSid === "string" && ids.has(rawSid)
                    ? rawSid
                    : (next[0]?.id ?? "");
              setSelectedId(sid);
            }
          }
          const legacyPf =
            parsed.projectFilters && typeof parsed.projectFilters === "object" && !Array.isArray(parsed.projectFilters)
              ? (parsed.projectFilters as ProjectFilters)
              : null;
          if (parsed.sidebarFilters && typeof parsed.sidebarFilters === "object" && !Array.isArray(parsed.sidebarFilters)) {
            if (!cancelled) {
              setSidebarFilters({ ...defaultProjectFilters(), ...(parsed.sidebarFilters as ProjectFilters) });
            }
          } else if (legacyPf && !cancelled) {
            setSidebarFilters({ ...defaultProjectFilters(), ...legacyPf });
          }
          if (parsed.detailFilters && typeof parsed.detailFilters === "object" && !Array.isArray(parsed.detailFilters)) {
            if (!cancelled) {
              setDetailFilters({ ...defaultProjectFilters(), ...(parsed.detailFilters as ProjectFilters) });
            }
          } else if (legacyPf && !cancelled) {
            setDetailFilters({ ...defaultProjectFilters(), ...legacyPf });
          }
          if (typeof parsed.sidebarSearch === "string" && !cancelled) {
            setSidebarSearch(parsed.sidebarSearch);
          }
          if (typeof parsed.detailSearch === "string" && !cancelled) {
            setDetailSearch(parsed.detailSearch);
          }
          if (parsed.selectOptions && typeof parsed.selectOptions === "object" && !Array.isArray(parsed.selectOptions)) {
            if (!cancelled) {
              setSelectOptions({ ...emptySelectOptions(), ...(parsed.selectOptions as SelectOptions) });
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    if (!isSupabaseDashboardEnabled()) {
      if (!cancelled) {
        supabaseProjectsBootstrappedRef.current = true;
        setStorageReady(true);
      }
      return () => {
        cancelled = true;
      };
    }

    /* 원격 프로젝트 로드 전에도 localStorage persist(멤버 포함)가 돌 수 있게 함 */
    if (!cancelled) {
      setStorageReady(true);
    }

    async function loadRemoteProjectsIfNeeded() {

      const {
        data: { user },
      } = await getSupabaseBrowserClient().auth.getUser();
      if (cancelled) return;
      if (!user) {
        supabaseProjectsBootstrappedRef.current = true;
        setStorageReady(true);
        return;
      }

      const shareId = getFlowchartShareId()?.trim() ?? "";
      if (!shareId) {
        if (!cancelled) {
          supabaseProjectsBootstrappedRef.current = true;
          setStorageReady(true);
        }
        return;
      }

      const loadGen = ++remoteProjectsLoadGenRef.current;
      try {
        const ensured = await ensureBoardMemberForCurrentUser();
        if (!ensured.ok) {
          console.error("[flowchart] ensureBoardMemberForCurrentUser failed", ensured);
        }
        if (!cancelled) {
          try {
            const { members: mbRows } = await loadMembersOnly();
            const mapped = mbRows.map(mapMemberRowToPageMember);
            setGlobalMembers(mapped);
            localMembersSnapshotRef.current = mapped;
          } catch (me) {
            console.error("[flowchart] loadMembersOnly failed", me);
          }
        }
        const data = await loadProjectsOnly();
        if (cancelled || loadGen !== remoteProjectsLoadGenRef.current) return;

        const memberIds = new Set(localMembersSnapshotRef.current.map((m) => m.id));
        const restored = normalizeStoredProjects(
          data.projects.map((row) => projectFromStorage(rowToProject(row as ProjectRow)))
        );
        const next = sanitizeAssigneesAgainstMembers(restored, memberIds);
        const finalProjects = next.length > 0 ? next : initialProjects;
        setProjects(finalProjects);
        setSelectedId((prev) => {
          const ids = new Set(finalProjects.map((p) => p.id));
          if (finalProjects.length === 0) return "";
          if (ids.has(prev)) return prev;
          return finalProjects[0]?.id ?? "";
        });
      } catch (e) {
        console.error("[flowchart] loadProjectsOnly failed", e);
      } finally {
        if (!cancelled) {
          supabaseProjectsBootstrappedRef.current = true;
          setStorageReady(true);
        }
      }
    }

    void loadRemoteProjectsIfNeeded();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !storageReady) return;
    try {
      const payload: PersistedState = {
        projects,
        selectedId,
        globalMembers: isSupabaseDashboardEnabled() ? [] : globalMembers,
        sidebarFilters,
        detailFilters,
        sidebarSearch,
        detailSearch,
        selectOptions,
      };
      localStorage.setItem(FLOWCHART_LEGACY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 할당량 초과 등
    }
  }, [projects, selectedId, globalMembers, storageReady, sidebarFilters, detailFilters, sidebarSearch, detailSearch, selectOptions]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageReady) return;

    const sp = new URLSearchParams(window.location.search);
    const urlProject = sp.get("project")?.trim() ?? "";
    const urlStep = sp.get("step")?.trim() ?? "";
    if (!urlProject && !urlStep) return;

    let cancelled = false;
    /** 브라우저 setTimeout 핸들(@types/node와 DOM 타입 충돌 방지) */
    let clearHighlightTimer: number | null = null;

    if (urlProject) {
      const exists = projects.some((p) => p.id === urlProject);
      if (!exists) return;
      if (selectedId !== urlProject) {
        setSelectedId(urlProject);
        return;
      }
    }

    if (!urlStep) {
      if (urlProject) {
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete("project");
          u.searchParams.delete("step");
          const qs = u.searchParams.toString();
          window.history.replaceState({}, "", qs ? `${u.pathname}?${qs}` : u.pathname);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    const pid = urlProject || selectedId;
    if (!pid) return;
    if (urlProject && selectedId !== urlProject) return;

    const proj = projects.find((p) => p.id === pid);
    if (!proj) return;
    const hasStep = proj.phases.some((ph) => stepIdExistsInSteps(ph.steps, urlStep));
    if (!hasStep) return;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const el = document.getElementById(`step-${urlStep}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedStepId(urlStep);
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete("project");
          u.searchParams.delete("step");
          const qs = u.searchParams.toString();
          window.history.replaceState({}, "", qs ? `${u.pathname}?${qs}` : u.pathname);
        } catch {
          /* ignore */
        }
        clearHighlightTimer = window.setTimeout(() => {
          setHighlightedStepId(null);
        }, 4000);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (clearHighlightTimer !== null) window.clearTimeout(clearHighlightTimer);
    };
  }, [storageReady, projects, selectedId]);

  useEffect(() => {
    if (!isSupabaseDashboardEnabled() || !storageReady) return;
    if (!getFlowchartShareId()) return;
    if (!supabaseProjectsBootstrappedRef.current) return;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      if (!supabaseProjectsBootstrappedRef.current) return;
      void syncProjectsOnly(projects).catch((e) => {
        console.error("[flowchart] syncProjectsOnly failed", e);
      });
    }, 800);

    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [projects, storageReady]);

  useEffect(() => {
    function teardownRealtimeChannel() {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
        realtimeDebounceRef.current = null;
      }
      if (realtimeMembersDebounceRef.current) {
        clearTimeout(realtimeMembersDebounceRef.current);
        realtimeMembersDebounceRef.current = null;
      }
      const ch = realtimeChannelRef.current;
      if (!ch) return;
      try {
        void getSupabaseBrowserClient().removeChannel(ch);
      } catch {
        /* 클라이언트 미구성 시 무시 */
      }
      realtimeChannelRef.current = null;
    }

    if (!subscriptionShareId) {
      teardownRealtimeChannel();
      return;
    }

    const sb = getSupabaseBrowserClient();
    const shareIdLocked: string = subscriptionShareId;
    const useServerFilter = SHARE_ID_UUID_RE.test(shareIdLocked);

    teardownRealtimeChannel();

    async function applyRemoteDashboard() {
      const loadGen = ++remoteProjectsLoadGenRef.current;
      try {
        const data = await loadProjectsOnly();
        if (loadGen !== remoteProjectsLoadGenRef.current) {
          return;
        }
        const memberIds = new Set(localMembersSnapshotRef.current.map((m) => m.id));
        const restored = normalizeStoredProjects(
          data.projects.map((row) => projectFromStorage(rowToProject(row as ProjectRow)))
        );
        const next = sanitizeAssigneesAgainstMembers(restored, memberIds);
        const finalProjects = next.length > 0 ? next : initialProjects;

        const fp = dashboardDataFingerprint(finalProjects);
        const fpSame = fp === lastRemoteFingerprintRef.current;

        if (fpSame && !DEBUG_REALTIME_DISABLE_FINGERPRINT_SKIP) {
          return;
        }

        lastRemoteFingerprintRef.current = fp;

        setProjects(finalProjects);
        setSelectedId((prev) => {
          const ids = new Set(finalProjects.map((p) => p.id));
          if (ids.has(prev)) {
            return prev;
          }
          if (finalProjects.length === 0) {
            return "";
          }
          const first = finalProjects[0]?.id ?? "";
          return first;
        });
      } catch (e) {
        console.error("[flowchart] realtime reload failed", e);
      }
    }

    function scheduleRemoteReload(_source: string) {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null;
        void applyRemoteDashboard();
      }, 400);
    }

    function scheduleMembersReload() {
      if (realtimeMembersDebounceRef.current) clearTimeout(realtimeMembersDebounceRef.current);
      realtimeMembersDebounceRef.current = setTimeout(() => {
        realtimeMembersDebounceRef.current = null;
        void refreshMembersFromServer();
      }, 400);
    }

    function onMembersPostgresChange() {
      return (payload: {
        eventType?: string;
        new?: { share_id?: string };
        old?: { share_id?: string };
      }) => {
        if (!useServerFilter && !realtimeEventMatchesShare(payload, shareIdLocked)) {
          return;
        }
        scheduleMembersReload();
      };
    }

    if (!useServerFilter) {
      console.warn(
        "[flowchart] realtime: NEXT_PUBLIC_FLOWCHART_SHARE_ID must be a UUID string. DB column share_id is uuid — Realtime filter `share_id=eq....` and sync may fail otherwise."
      );
    }

    function onPostgresChange() {
      return (payload: {
        eventType?: string;
        new?: { share_id?: string };
        old?: { share_id?: string };
      }) => {
        if (!useServerFilter && !realtimeEventMatchesShare(payload, shareIdLocked)) {
          return;
        }
        scheduleRemoteReload(`projects:${payload.eventType ?? "?"}`);
      };
    }

    const channelTopic = `dashboard-realtime-${shareIdLocked}`;
    const channel = sb.channel(channelTopic);
    if (useServerFilter) {
      const filter = `share_id=eq.${shareIdLocked}`;
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter },
        onPostgresChange()
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "members", filter },
        onMembersPostgresChange()
      );
    } else {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "projects" }, onPostgresChange());
      channel.on("postgres_changes", { event: "*", schema: "public", table: "members" }, onMembersPostgresChange());
    }

    channel.subscribe(() => {});

    realtimeChannelRef.current = channel;

    return () => {
      teardownRealtimeChannel();
    };
  }, [subscriptionShareId, refreshMembersFromServer]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? projects[0] ?? null,
    [projects, selectedId]
  );

  useEffect(() => {
    if (!selectedProject) return;

    setStepDrafts((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const phase of selectedProject.phases) {
        forEachStepInTree(phase.steps, (step) => {
          const current = next[step.id];
          if (!current) {
            next[step.id] = stepToDraft(step);
            changed = true;
            return;
          }

          const shouldSyncConfirmedAt = current.confirmedAt !== step.confirmedAt;
          const shouldSyncDueDate = current.dueDate !== step.dueDate && current.dueDate === "";
          const shouldSyncAssignee =
            !idSetsEqual(current.assigneeMemberIds, step.assigneeMemberIds) &&
            current.assigneeMemberIds.length === 0;
          const shouldSyncMemo = current.memo !== step.memo && current.memo === "";

          if (shouldSyncConfirmedAt || shouldSyncDueDate || shouldSyncAssignee || shouldSyncMemo) {
            next[step.id] = {
              dueDate: shouldSyncDueDate ? step.dueDate : current.dueDate,
              confirmedAt: step.confirmedAt,
              memo: shouldSyncMemo ? step.memo : current.memo,
              assigneeMemberIds: shouldSyncAssignee ? [...step.assigneeMemberIds] : current.assigneeMemberIds,
            };
            changed = true;
          }
        });
      }

      return changed ? next : prev;
    });
  }, [selectedProject]);

  useEffect(() => {
    const proj = projects.find((p) => p.id === selectedId) ?? null;
    if (!proj) {
      setStepDrafts({});
      return;
    }
    const m: Record<string, StepEditorDraft> = {};
    for (const ph of proj.phases) {
      forEachStepInTree(ph.steps, (s) => {
        m[s.id] = stepToDraft(s);
      });
    }
    setStepDrafts(m);
    // 프로젝트 데이터가 바뀔 때마다 초기화하면 편집 중인 draft가 날아가므로 selectedId 전환 시에만 동기화
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 위 의도
  }, [selectedId]);

  useEffect(() => {
    setSelectOptions((prev) => mergeSelectOptionsWithProjects(prev, projects));
  }, [projects]);

  function toggleSidebarFilterValue(field: keyof ProjectFilters, value: string | ProjectStatus) {
    setSidebarFilters((prev) => {
      if (field === "status") {
        const st = value as ProjectStatus;
        const cur = [...prev.status];
        const i = cur.indexOf(st);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(st);
        return { ...prev, status: cur };
      }
      const fk = field as Exclude<keyof ProjectFilters, "status">;
      const cur = [...(prev[fk] as string[])];
      const v = String(value);
      const i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(v);
      return { ...prev, [fk]: cur };
    });
  }

  function toggleDetailFilterValue(field: keyof ProjectFilters, value: string | ProjectStatus) {
    setDetailFilters((prev) => {
      if (field === "status") {
        const st = value as ProjectStatus;
        const cur = [...prev.status];
        const i = cur.indexOf(st);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(st);
        return { ...prev, status: cur };
      }
      const fk = field as Exclude<keyof ProjectFilters, "status">;
      const cur = [...(prev[fk] as string[])];
      const v = String(value);
      const i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(v);
      return { ...prev, [fk]: cur };
    });
  }

  const sidebarFilteredProjects = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    let list = applyProjectFilters(projects, sidebarFilters);
    if (q) {
      list = list.filter((project) => {
        const blob = [
          project.code,
          project.country,
          project.certificate,
          project.businessModel,
          project.incoterms,
          project.exporter,
          project.item,
          project.client,
          project.note,
        ]
          .map((x) => (x == null ? "" : String(x)))
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    return [...list].sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" }));
  }, [projects, sidebarFilters, sidebarSearch]);

  const overviewFilteredProjects = useMemo(() => {
    let list = applyProjectFilters(projects, detailFilters);
    const q = detailSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((project) => {
        const blob = [
          project.code,
          project.country,
          project.certificate,
          project.businessModel,
          project.incoterms,
          project.exporter,
          project.item,
          project.client,
          project.note,
        ]
          .map((x) => (x == null ? "" : String(x)))
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    const sorted = [...list];
    if (overviewSortBy === "CODE_ASC") {
      sorted.sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" }));
    } else if (overviewSortBy === "CODE_DESC") {
      sorted.sort((a, b) => b.code.localeCompare(a.code, undefined, { sensitivity: "base" }));
    } else if (overviewSortBy === "PROGRESS_DESC") {
      sorted.sort((a, b) => getProjectProgress(b).percent - getProjectProgress(a).percent);
    } else {
      sorted.sort((a, b) => b.lastChangedAt.localeCompare(a.lastChangedAt));
    }
    return sorted;
  }, [projects, detailFilters, detailSearch, overviewSortBy]);

  const boardGroups = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const project of overviewFilteredProjects) {
      const key =
        typeof project.item === "string" && project.item.trim() ? project.item.trim() : "NO ITEM";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(project);
    }
    return Array.from(map.entries()).filter(([, list]) => list.length > 0);
  }, [overviewFilteredProjects]);

  function updateProjectField(
    projectId: string,
    field: keyof ProjectHeaderDraft,
    value: string | ProjectStatus
  ) {
    if (projectId !== selectedId) return;

    const normalizeUpper = (s: string) => {
      const t = s.trim();
      return t.length ? t.toUpperCase() : "";
    };

    if (field === "code") {
      const nextCode = String(value).trim();
      const duplicate = projects.some(
        (project) =>
          project.id !== projectId &&
          project.code.trim().toLowerCase() === nextCode.toLowerCase()
      );
      if (nextCode && duplicate) {
        alert("다른 프로젝트가 이미 같은 CODE를 사용 중입니다.");
        return;
      }
    }

    const ts = nowString();
    const autoConfirmedAt = todayLocalDate();

    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;

        let nextProject: Project = {
          ...project,
          code:
            field === "code"
              ? String(value).trim() || "DRAFT"
              : project.code,
          status:
            field === "status"
              ? (value as ProjectStatus)
              : project.status,
          country:
            field === "country"
              ? normalizeUpper(String(value))
              : project.country,
          certificate:
            field === "certificate"
              ? String(value).trim()
              : project.certificate,
          businessModel:
            field === "businessModel"
              ? String(value).trim()
              : project.businessModel,
          incoterms:
            field === "incoterms"
              ? String(value).trim()
              : project.incoterms,
          exporter:
            field === "exporter"
              ? String(value).trim()
              : project.exporter,
          client:
            field === "client"
              ? String(value).trim()
              : project.client,
          item:
            field === "item"
              ? normalizeUpper(String(value))
              : project.item,
          hsCode:
            field === "hsCode"
              ? String(value).trim()
              : project.hsCode,
          customRate:
            field === "customRate"
              ? String(value).trim()
              : project.customRate,
          vatRate:
            field === "vatRate"
              ? String(value).trim()
              : project.vatRate,
          etd:
            field === "etd"
              ? String(value).trim()
              : project.etd,
          eta:
            field === "eta"
              ? String(value).trim()
              : project.eta,
          priceValue:
            field === "priceValue"
              ? String(value).trim()
              : project.priceValue,
          priceCurrency:
            field === "priceCurrency"
              ? (value as "USD" | "KRW")
              : project.priceCurrency,
          priceUnit:
            field === "priceUnit"
              ? (value as "KG" | "LB" | "UNIT")
              : project.priceUnit,
          offerPriceValue:
            field === "offerPriceValue"
              ? String(value).trim()
              : project.offerPriceValue,
          offerPriceCurrency:
            field === "offerPriceCurrency"
              ? (value as "USD" | "KRW")
              : project.offerPriceCurrency,
          offerPriceUnit:
            field === "offerPriceUnit"
              ? (value as "KG" | "LB" | "UNIT")
              : project.offerPriceUnit,
          finalPriceValue:
            field === "finalPriceValue"
              ? String(value).trim()
              : project.finalPriceValue,
          finalPriceCurrency:
            field === "finalPriceCurrency"
              ? (value as "USD" | "KRW")
              : project.finalPriceCurrency,
          finalPriceUnit:
            field === "finalPriceUnit"
              ? (value as "KG" | "LB" | "UNIT")
              : project.finalPriceUnit,
          updated: true,
          lastChangedAt: ts,
        };

        if (field === "certificate" && nextProject.certificate !== "") {
          nextProject = autoCheckProjectStepByLabel(
            nextProject,
            "2-2 인증정보 확인",
            autoConfirmedAt,
            ts
          );
        }

        if (field === "priceValue" && nextProject.priceValue !== "") {
          nextProject = autoCheckProjectStepByLabel(
            nextProject,
            "3-2 ORDER PRICE 체크",
            autoConfirmedAt,
            ts
          );
        }

        if (field === "offerPriceValue" && nextProject.offerPriceValue !== "") {
          nextProject = autoCheckProjectStepByLabel(
            nextProject,
            "3-3 CLIENT 오퍼가격 확인",
            autoConfirmedAt,
            ts
          );
        }

        if (field === "finalPriceValue" && nextProject.finalPriceValue !== "") {
          nextProject = autoCheckProjectStepByLabel(
            nextProject,
            "Settlement",
            autoConfirmedAt,
            ts
          );
        }

        return nextProject;
      })
    );
  }

  function handleCreatableCreate(
    optionField: SelectOptionFieldKey,
    draftField: keyof ProjectHeaderDraft,
    raw: string
  ) {
    if (!selectedProject) return;
    setSelectOptions((prev) => {
      const r = addOptionToList(prev[optionField], raw);
      if (!r) return prev;
      updateProjectField(selectedProject.id, draftField, r.canonical);
      return { ...prev, [optionField]: r.next };
    });
  }

  function removeOption(field: SelectOptionFieldKey, value: string) {
    if (countOptionUsage(field, value, projects) > 0) return;
    setSelectOptions((prev) => ({ ...prev, [field]: removeOptionFromList(prev[field], value) }));
  }

  function handleAddOption(field: SelectOptionFieldKey, rawValue: string) {
    setSelectOptions((prev) => {
      const r = addOptionToList(prev[field], rawValue);
      return r ? { ...prev, [field]: r.next } : prev;
    });
  }

  function createNewProjectFlow() {
    const p = makeProject({
      code: "DRAFT",
      status: "DRAFT",
      note: "",
      updated: true,
      lastChangedAt: nowString(),
      notificationLogs: [],
    });
    setProjects((prev) => [p, ...prev]);
    setSelectedId(p.id);
    setAllProjectsExpanded(false);
  }

  function deleteSelectedProject() {
    if (!selectedProject) return;
    const ok = window.confirm(`${selectedProject.code} 프로젝트를 삭제할까요?`);
    if (!ok) return;

    const next = projects.filter((project) => project.id !== selectedProject.id);
    setProjects(next);
    setSelectedId(next[0]?.id ?? "");
    setAllProjectsExpanded(false);
  }

  function updateStep(projectId: string, phaseId: string, stepId: string, patch: Partial<Step>) {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          updated: true,
          lastChangedAt: nowString(),
          phases: project.phases.map((phase) =>
            phase.id !== phaseId
              ? phase
              : {
                  ...phase,
                  steps: reconcilePhaseSteps(
                    patchStepInTree(phase.steps, stepId, (step) => {
                      const next: Step = { ...step, ...patch };
                      if (patch.dueDate !== undefined && patch.dueDate !== step.dueDate) {
                        next.dueReminderSentAt = "";
                      }
                      if (
                        patch.assigneeMemberIds !== undefined &&
                        !idSetsEqual(patch.assigneeMemberIds, step.assigneeMemberIds)
                      ) {
                        next.dueReminderSentAt = "";
                      }
                      return next;
                    })
                  ),
                }
          ),
        };
      })
    );
  }

  function toggleStepNotApplicable(
    projectId: string,
    phaseId: string,
    stepId: string,
    checked: boolean
  ) {
    const phase = projects.find((p) => p.id === projectId)?.phases.find((ph) => ph.id === phaseId);
    const st = phase ? findStepInPhaseSteps(phase.steps, stepId) : undefined;
    if (!st) return;

    if (checked) {
      const confirmed = st.confirmedAt?.trim() ? st.confirmedAt : todayLocalDate();
      setProjects((prev) =>
        prev.map((project) => {
          if (project.id !== projectId) return project;
          return {
            ...project,
            updated: true,
            lastChangedAt: nowString(),
            phases: project.phases.map((ph) =>
              ph.id !== phaseId
                ? ph
                : {
                    ...ph,
                    steps: reconcilePhaseSteps(
                      patchStepInTree(ph.steps, stepId, (step) => ({
                        ...step,
                        notApplicable: true,
                        checked: true,
                        confirmedAt: confirmed,
                        dueReminderSentAt: "",
                      }))
                    ),
                  }
            ),
          };
        })
      );
      setStepDrafts((prev) => ({
        ...prev,
        [stepId]: { ...(prev[stepId] ?? stepToDraft(st)), confirmedAt: confirmed },
      }));
      return;
    }

    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          updated: true,
          lastChangedAt: nowString(),
          phases: project.phases.map((ph) =>
            ph.id !== phaseId
              ? ph
              : {
                  ...ph,
                  steps: reconcilePhaseSteps(
                    patchStepInTree(ph.steps, stepId, (step) => ({
                      ...step,
                      notApplicable: false,
                      checked: false,
                    }))
                  ),
                }
          ),
        };
      })
    );
    setStepDrafts((prev) => ({
      ...prev,
      [stepId]: { ...(prev[stepId] ?? stepToDraft(st)), confirmedAt: st.confirmedAt },
    }));
  }

  function toggleStepChecked(projectId: string, phaseId: string, stepId: string, checked: boolean) {
    const phase = projects.find((p) => p.id === projectId)?.phases.find((ph) => ph.id === phaseId);
    const st = phase ? findStepInPhaseSteps(phase.steps, stepId) : undefined;
    if (st?.notApplicable) return;
    const newConfirmed =
      !st ? "" : checked ? (st.confirmedAt?.trim() ? st.confirmedAt : todayLocalDate()) : st.confirmedAt;

    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          updated: true,
          lastChangedAt: nowString(),
          phases: project.phases.map((ph) =>
            ph.id !== phaseId
              ? ph
              : {
                  ...ph,
                  steps: reconcilePhaseSteps(
                    patchStepInTree(ph.steps, stepId, (step) => ({
                      ...step,
                      checked,
                      confirmedAt: newConfirmed,
                      dueReminderSentAt: checked ? "" : step.dueReminderSentAt,
                    }))
                  ),
                }
          ),
        };
      })
    );

    if (st) {
      setStepDrafts((prev) => ({
        ...prev,
        [stepId]: {
          ...(prev[stepId] ?? stepToDraft(st)),
          confirmedAt: newConfirmed,
        },
      }));
    }
  }

  function toggleStepExpanded(projectId: string, phaseId: string, stepId: string) {
    const phase = projects.find((p) => p.id === projectId)?.phases.find((ph) => ph.id === phaseId);
    const st = phase ? findStepInPhaseSteps(phase.steps, stepId) : undefined;
    if (!st?.subSteps?.length) return;
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          updated: true,
          lastChangedAt: nowString(),
          phases: project.phases.map((ph) =>
            ph.id !== phaseId
              ? ph
              : {
                  ...ph,
                  steps: patchStepInTree(ph.steps, stepId, (step) => ({
                    ...step,
                    expanded: !step.expanded,
                  })),
                }
          ),
        };
      })
    );
  }

  async function removeGlobalMember(memberId: string) {
    const target = globalMembers.find((m) => m.id === memberId);
    if (!target) return;

    if (authUserId && target.userId && target.userId === authUserId) {
      alert("본인 계정은 삭제할 수 없습니다.");
      return;
    }

    if (!canDeleteMembers) {
      alert("관리자만 멤버를 삭제할 수 있습니다.");
      return;
    }

    if (isSupabaseDashboardEnabled() && getFlowchartShareId()) {
      const res = await deleteBoardMemberAsAdmin(memberId);
      if (!res.ok) {
        alert(res.message ?? "삭제에 실패했습니다.");
        return;
      }
      await refreshMembersFromServer();
    } else {
      setGlobalMembers(globalMembers.filter((member) => member.id !== memberId));
    }

    setProjects((prev) =>
      prev.map((project) => ({
        ...project,
        phases: project.phases.map((phase) => ({
          ...phase,
          steps: phase.steps.map((step) => removeMemberFromStepTree(step, memberId)),
        })),
      }))
    );
  }

  function patchStepDraft(stepId: string, patch: Partial<StepEditorDraft>, baseStep: Step) {
    setStepDrafts((prev) => ({
      ...prev,
      [stepId]: { ...(prev[stepId] ?? stepToDraft(baseStep)), ...patch },
    }));
  }

  function resetStepDraftFields(stepId: string) {
    setStepDrafts((prev) => ({
      ...prev,
      [stepId]: {
        dueDate: "",
        confirmedAt: "",
        memo: "",
        assigneeMemberIds: [],
      },
    }));
  }

  function applyMentionToDraft(stepId: string, member: Member, baseStep: Step) {
    setStepDrafts((prev) => {
      const cur = prev[stepId] ?? stepToDraft(baseStep);
      const query = extractMentionQuery(cur.memo);
      if (query === null) return prev;
      const replaced = cur.memo.replace(/@([^\s@]*)$/, `@${member.name} `);
      return { ...prev, [stepId]: { ...cur, memo: replaced } };
    });
  }

  async function saveStepDraft(projectId: string, phaseId: string, stepId: string) {
    if (!selectedProject || savingStepId) return;
    const phase = selectedProject.phases.find((ph) => ph.id === phaseId);
    const step = phase ? findStepInPhaseSteps(phase.steps, stepId) : undefined;
    if (!phase || !step) return;

    const draft = stepDrafts[stepId] ?? stepToDraft(step);
    const text = draft.memo.trim();
    const mentions = extractMentionsFromText(draft.memo, globalMembers);
    const recipientsForNotify = buildNotificationRecipients(
      draft.memo,
      draft.assigneeMemberIds,
      globalMembers
    );
    const notifyText =
      draft.memo.trim() || `${step.label} 단계가 업데이트되었습니다.`;

    console.log("[notify] mentions", mentions);
    console.log("[notify] assigneeMemberIds", draft.assigneeMemberIds);
    console.log("[notify] recipientsForNotify", recipientsForNotify);

    setSavingStepId(stepId);
    let emailNotify: NotificationLog["emailNotify"] | undefined;
    let notifyFetchThrew = false;
    const logCreatedAt = nowString();
    const stepLink = buildFlowchartStepDeepLink(selectedProject.id, step.id);

    try {
      if (recipientsForNotify.length > 0) {
        const requestBody = {
          recipients: recipientsForNotify.map((m) => ({ email: m.email, name: m.name })),
          projectCode: selectedProject.code,
          stepLabel: step.label,
          phaseTitle: phase.title,
          authorName: "나",
          commentText: notifyText,
          createdAt: logCreatedAt,
          stepLink,
          projectId: selectedProject.id,
          stepId: step.id,
        };
        console.log("[notify] requestBody", requestBody);

        try {
          const res = await fetch("/api/notify-mention", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          const data = (await res.json()) as MentionNotifyResponse & { error?: string };
          console.log("[notify] response.ok", res.ok);
          console.log("[notify] responseData", data);

          if (!res.ok) {
            throw new Error(data.error || `요청 실패 (${res.status})`);
          }

          const perRecipient = data.results.map((r) => ({
            email: r.email,
            name: r.name,
            ok: r.ok,
            error: r.error,
          }));

          emailNotify = {
            attemptedAt: nowString(),
            mock: data.mock,
            overallOk: perRecipient.length > 0 && perRecipient.every((r) => r.ok),
            perRecipient,
          };
        } catch (e) {
          notifyFetchThrew = true;
          const msg = e instanceof Error ? e.message : "알 수 없는 오류";
          alert(`알림 메일 발송 실패: ${msg}`);
          emailNotify = {
            attemptedAt: nowString(),
            mock: true,
            overallOk: false,
            overallError: msg,
            perRecipient: recipientsForNotify.map((m) => ({
              email: m.email,
              name: m.name,
              ok: false,
              error: msg,
            })),
          };
        }
      }

      const comment: StepComment | null = text
        ? {
            id: createId("comment"),
            authorName: "나",
            message: draft.memo,
            mentions,
            createdAt: logCreatedAt,
          }
        : null;

      const newLogs: NotificationLog[] =
        recipientsForNotify.length > 0 && emailNotify
          ? [
              {
                id: createId("log"),
                kind: "mention",
                projectCode: selectedProject.code,
                phaseTitle: phase.title,
                stepLabel: step.label,
                authorName: "나",
                commentText: notifyText,
                stepLink,
                recipients: recipientsForNotify,
                createdAt: logCreatedAt,
                emailNotify,
              },
            ]
          : [];

      let nextReminder = step.dueReminderSentAt;
      if (draft.dueDate !== step.dueDate || !idSetsEqual(draft.assigneeMemberIds, step.assigneeMemberIds)) {
        nextReminder = "";
      }

      setProjects((prev) =>
        prev.map((project) => {
          if (project.id !== projectId) return project;
          return {
            ...project,
            updated: true,
            lastChangedAt: nowString(),
            notificationLogs: [...newLogs, ...project.notificationLogs],
            phases: project.phases.map((ph) =>
              ph.id !== phaseId
                ? ph
                : {
                    ...ph,
                    steps: reconcilePhaseSteps(
                      patchStepInTree(ph.steps, stepId, (s) => ({
                        ...s,
                        dueDate: draft.dueDate,
                        confirmedAt: draft.confirmedAt,
                        memo: draft.memo,
                        assigneeMemberIds: [...draft.assigneeMemberIds],
                        dueReminderSentAt: nextReminder,
                        comments: comment ? [comment, ...s.comments] : s.comments,
                      }))
                    ),
                  }
            ),
          };
        })
      );

      setStepDrafts((prev) => ({
        ...prev,
        [stepId]: { ...draft },
      }));

      if (recipientsForNotify.length === 0) {
        alert("저장은 완료됐지만 알림 대상이 없어 메일은 보내지 않았습니다.");
      } else if (emailNotify?.overallOk) {
        alert("저장 및 알림 전송 완료");
      } else if (!notifyFetchThrew) {
        alert("저장은 완료됐지만 알림 메일 발송은 실패했습니다.");
      }
    } finally {
      setSavingStepId(null);
    }
  }

  async function runDueReminderScan() {
    if (dueReminderBusy) return;
    setDueReminderBusy(true);
    try {
      const appBaseUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;
      const body = buildDueReminderProcessRequest(
        projects.map((p) => ({
          id: p.id,
          code: p.code,
          phases: p.phases.map((ph) => ({
            id: ph.id,
            title: ph.title,
            steps: ph.steps.map((s) => stepToDueReminderInput(s)),
          })),
        })),
        globalMembers.map((m) => ({ id: m.id, name: m.name, email: m.email })),
        appBaseUrl
      );

      console.log("[due-reminder] body", body);

      const res = await fetch("/api/due-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as DueReminderProcessResponse & { error?: string };
      console.log("[due-reminder] response", data);
      if (!res.ok) {
        throw new Error(data.error || `요청 실패 (${res.status})`);
      }

      setProjects((prev) => {
        const processed = data.processed ?? [];
        const nextProjects = applyDueReminderJobResults(prev, processed);
        if (!processed.length) return nextProjects;

        const extraByProject = new Map<string, NotificationLog[]>();

        for (const r of processed) {
          const proj = prev.find((p) => p.id === r.projectId);
          if (!proj) continue;
          const phase = proj.phases.find((ph) => ph.id === r.phaseId);
          const step = phase ? findStepInPhaseSteps(phase.steps, r.stepId) : undefined;
          if (!phase || !step) continue;
          const rid = r.recipientMemberId ?? step.assigneeMemberIds[0];
          const assignee = rid ? globalMembers.find((m) => m.id === rid) : undefined;

          const attemptedAt = r.sentAt || new Date().toISOString();
          const stepLinkLine = buildFlowchartStepDeepLink(proj.id, step.id);
          const log: NotificationLog = {
            id: createId("log"),
            kind: "due_reminder",
            projectCode: proj.code,
            phaseTitle: phase.title,
            stepLabel: step.label,
            authorName: "Due Reminder",
            stepLink: stepLinkLine,
            commentText: `Due 24h 알림 · 마감: ${normalizeDateOnly(step.dueDate) || step.dueDate}\n\n열기: ${stepLinkLine}`,
            recipients: assignee
              ? [{ memberId: assignee.id, name: assignee.name, email: assignee.email }]
              : [],
            createdAt: nowString(),
            emailNotify: {
              attemptedAt,
              mock: data.mock,
              overallOk: r.ok,
              overallError: r.error,
              perRecipient: [
                {
                  email: assignee?.email ?? "",
                  name: assignee?.name ?? "",
                  ok: r.ok,
                  error: r.error,
                },
              ],
            },
          };
          extraByProject.set(proj.id, [...(extraByProject.get(proj.id) ?? []), log]);
        }

        return nextProjects.map((p) => {
          const extra = extraByProject.get(p.id);
          if (!extra?.length) return p;
          return {
            ...p,
            updated: true,
            lastChangedAt: nowString(),
            notificationLogs: [...extra, ...p.notificationLogs],
          };
        });
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Due 알림 검사 실패");
    } finally {
      setDueReminderBusy(false);
    }
  }

  const selectedProgress = selectedProject
    ? getProjectProgress(selectedProject)
    : { total: 0, done: 0, percent: 0 };

  const selectedNextDue = selectedProject ? getNextDueStep(selectedProject) : null;
  const selectedOverdueCount = selectedProject ? getOverdueCount(selectedProject) : 0;

  async function handleLogout() {
    console.log("[1] clicked");
    const supabase = getSupabaseBrowserClient();
    console.log("[2] before signOut");
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error(e);
    }
    console.log("[3] after signOut");
    localStorage.removeItem("flowchart-dashboard-v4");
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    console.log("[4] before redirect");
    window.location.href = "/login";
    console.log("[5] after redirect code reached");
  }

  return (
    <div className="flex h-screen bg-[#f6f5f3] text-neutral-900">
      <aside className="flex min-h-0 w-[310px] shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="shrink-0 border-b border-neutral-200 px-3 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMemberPanelOpen((prev) => !prev)}
              className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium"
            >
              Show Members
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium"
            >
              로그아웃
            </button>
          </div>
        </div>

        {memberPanelOpen ? (
          <div className="max-h-[min(40vh,20rem)] shrink-0 overflow-y-auto border-b border-neutral-200 bg-[#f8f7f5] px-2 py-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="text-xs font-semibold">Members</div>
              <div className="text-[10px] text-neutral-500">{globalMembers.length}명</div>
            </div>
            <div className="space-y-2">
              {globalMembers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-200 bg-white px-3 py-4 text-center text-xs text-neutral-400">
                  등록된 멤버가 없습니다.
                </div>
              ) : (
                globalMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-2 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <MemberInitial name={member.name} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="truncate text-xs font-semibold">{member.name}</span>
                          {member.userId &&
                          authUserId &&
                          member.userId === authUserId &&
                          (!authUserEmail?.trim() ||
                            member.email.trim().toLowerCase() === authUserEmail.trim().toLowerCase()) ? (
                            <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-800">
                              나
                            </span>
                          ) : null}
                          {isMemberOnline(member.lastSeenAt) ? (
                            <span className="shrink-0 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-800">
                              접속
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-[10px] text-neutral-500">{member.email}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeGlobalMember(member.id)}
                      disabled={
                        !canDeleteMembers || Boolean(authUserId && member.userId && member.userId === authUserId)
                      }
                      className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="shrink-0 border-b border-neutral-200 p-3">
          <div className="grid grid-cols-[1fr_88px] overflow-hidden rounded-2xl border border-neutral-200">
            <div className="flex items-center justify-center border-r border-neutral-200 bg-white px-4 py-8">
              <div className="text-[20px] font-black tracking-[-0.04em]">PROJECT</div>
            </div>

            <div className="flex flex-col bg-white">
              <button
                type="button"
                onClick={createNewProjectFlow}
                className="border-b border-neutral-200 px-3 py-3 text-left text-sm font-semibold"
              >
                NEW
              </button>

              <button
                type="button"
                onClick={() => setSearchPanelOpen((prev) => !prev)}
                className="border-b border-neutral-200 px-3 py-3 text-left text-sm font-semibold"
              >
                SEARCH
              </button>

              <button
                type="button"
                onClick={() => setFilterPanelOpen((prev) => !prev)}
                className="border-b border-neutral-200 px-3 py-3 text-left text-sm font-semibold"
              >
                FILTER
              </button>

              <button
                type="button"
                onClick={() => setAllProjectsExpanded(true)}
                className="px-3 py-3 text-left text-sm font-semibold text-red-500"
              >
                &gt;&gt;
              </button>
            </div>
          </div>

          {searchPanelOpen ? (
            <div className="mt-3">
              <input
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none"
              />
            </div>
          ) : null}

          {filterPanelOpen ? (
            <div className="mt-3 rounded-2xl border border-neutral-200 bg-[#faf9f7] p-2">
              <SidebarFilterAccordion
                projects={projects}
                selectOptions={selectOptions}
                sidebarFilters={sidebarFilters}
                toggleSidebarFilterValue={toggleSidebarFilterValue}
              />
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-3">
            {sidebarFilteredProjects.map((project) => {
              const isSelected = project.id === selectedId;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(project.id);
                    setAllProjectsExpanded(false);
                  }}
                  className={[
                    "w-full rounded-2xl border px-4 py-4 text-left transition",
                    isSelected
                      ? "border-neutral-900 bg-[#eef3ef] shadow-sm"
                      : "border-neutral-200 bg-white hover:bg-neutral-50",
                  ].join(" ")}
                >
                  <div className="text-[15px] font-bold tracking-[-0.03em] text-neutral-900">
                    {project.code?.trim() || "(NO CODE)"}
                  </div>
                  <ProjectProgressRow project={project} />
                </button>
              );
            })}

            {sidebarFilteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">
                검색 또는 필터 결과가 없습니다.
              </div>
            ) : null}
          </div>
        </div>

        <OptionManageModal
          open={optionManageField !== null}
          field={optionManageField}
          title={
            optionManageField === "items"
              ? "ITEM"
              : optionManageField === "countries"
                ? "COUNTRY"
                : optionManageField === "certificates"
                  ? "CERTIFICATE"
                  : optionManageField === "businessModels"
                    ? "BUSINESS MODEL"
                    : optionManageField === "incoterms"
                      ? "INCOTERMS"
                      : optionManageField === "exporters"
                        ? "EXPORTER"
                        : optionManageField === "clients"
                          ? "CLIENT"
                          : optionManageField === "hsCodes"
                            ? "H.S CODE"
                            : ""
          }
          options={selectOptions}
          projects={projects}
          onClose={() => setOptionManageField(null)}
          onRemoveOption={(field, value) => {
            removeOption(field, value);
          }}
          onAddOption={handleAddOption}
        />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {allProjectsExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f6f5f3]">
            <div className="shrink-0 border-b border-neutral-200 bg-white px-6 py-4">
              <div className="mx-auto w-full max-w-[1600px]">
                <ProjectExplorerFilterBar
                  projects={projects}
                  selectOptions={selectOptions}
                  detailSearch={detailSearch}
                  setDetailSearch={setDetailSearch}
                  detailFilters={detailFilters}
                  toggleDetailFilterValue={toggleDetailFilterValue}
                  overviewSortBy={overviewSortBy}
                  setOverviewSortBy={setOverviewSortBy}
                />
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAllProjectsExpanded(false)}
                    className="rounded-xl border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
                  >
                    상세 화면으로
                  </button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto p-6">
              {boardGroups.length === 0 ? (
                <div className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-dashed border-neutral-200 bg-white px-6 py-12 text-center text-sm text-neutral-500">
                  {projects.length === 0 ? (
                    <div>
                      <div className="text-base font-semibold text-neutral-800">프로젝트가 없습니다.</div>
                      <div className="mt-2 text-xs text-neutral-500">왼쪽에서 NEW로 추가하세요.</div>
                    </div>
                  ) : (
                    <span>조건에 맞는 프로젝트가 없습니다. 필터·검색을 조정해 보세요.</span>
                  )}
                </div>
              ) : (
                <div className="flex min-w-max gap-6">
                  {boardGroups.map(([itemName, list]) => (
                    <section key={itemName} className="w-[280px] shrink-0">
                      <div className="mb-4 flex items-center gap-3">
                        <span className="rounded-full bg-[#dbe9df] px-3 py-1 text-sm font-semibold text-neutral-800">
                          {itemName}
                        </span>
                        <span className="text-sm text-neutral-500">{list.length}</span>
                      </div>

                      <div className="space-y-3">
                        {list.map((project) => {
                          const isSelected = project.id === selectedId;

                          return (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => {
                                setSelectedId(project.id);
                                setAllProjectsExpanded(false);
                              }}
                              className={[
                                "w-full rounded-[24px] border p-4 text-left shadow-sm transition",
                                isSelected
                                  ? "border-neutral-900 bg-[#eef3ef]"
                                  : "border-neutral-200 bg-[#dfe8e3] hover:translate-y-[-1px]",
                              ].join(" ")}
                            >
                              <div className="mb-3 text-[18px] font-bold tracking-[-0.03em]">
                                {project.code?.trim() || "(NO CODE)"}
                              </div>

                              <div className="mb-2 flex flex-wrap gap-2">
                                {project.country?.trim() ? (
                                  <span className="rounded-md bg-white/50 px-2 py-1 text-xs font-medium text-neutral-700">
                                    {project.country}
                                  </span>
                                ) : null}

                                {project.exporter?.trim() ? (
                                  <span className="rounded-md bg-white/50 px-2 py-1 text-xs font-medium text-neutral-700">
                                    {project.exporter}
                                  </span>
                                ) : null}

                                {project.client?.trim() ? (
                                  <span className="rounded-md bg-white/50 px-2 py-1 text-xs font-medium text-neutral-700">
                                    {project.client}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mb-3 min-h-[40px] text-sm leading-6 text-neutral-700">
                                {project.note?.trim() || ""}
                              </div>
                              <ProjectProgressRow project={project} />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full min-h-0 flex-1 overflow-y-auto bg-[#f6f5f3]">
            {selectedProject ? (
              <div className="mx-auto w-full max-w-[1600px] px-8 py-6">
                <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">Selected Project</div>

                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <input
                        value={selectedProject.code}
                        onChange={(e) => updateProjectField(selectedProject.id, "code", e.target.value)}
                        placeholder="CODE"
                        className="min-w-[180px] max-w-[360px] border-0 bg-transparent p-0 text-[32px] font-black tracking-[-0.05em] text-neutral-900 outline-none placeholder:text-neutral-300"
                      />

                      <select
                        value={selectedProject.status}
                        onChange={(e) => updateProjectField(selectedProject.id, "status", e.target.value as ProjectStatus)}
                        className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-[12px] font-semibold text-neutral-700 outline-none"
                      >
                        <option value="REVIEW">REVIEW</option>
                        <option value="IN PROGRESS">IN PROGRESS</option>
                        <option value="HOLD">HOLD</option>
                        <option value="DONE">DONE</option>
                        <option value="DRAFT">DRAFT</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAllProjectsExpanded(true)}
                      className="shrink-0 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm"
                    >
                      전체 프로젝트 보기
                    </button>

                    <button
                      type="button"
                      onClick={deleteSelectedProject}
                      className="shrink-0 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-500"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={"rounded-md px-2 py-0.5 text-[10px] font-semibold " + itemPillStyle(selectedProject.item)}
                >
                  {selectedProject.item ?? "-"}
                </span>
                <span className="text-[10px] text-neutral-500">
                  {selectedProgress.percent}% · {selectedProject.lastChangedAt}
                </span>
              </div>

              <>
                  <div className="mb-4 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-5">
                    <Field label="ITEM">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.item}
                        options={selectOptions.items}
                        onChange={(v) => updateProjectField(selectedProject.id, "item", v)}
                        onCreate={(raw) => handleCreatableCreate("items", "item", raw)}
                        onOpenManage={() => setOptionManageField("items")}
                        placeholder="ITEM"
                      />
                    </Field>

                    <Field label="COUNTRY">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.country}
                        options={selectOptions.countries}
                        onChange={(v) => updateProjectField(selectedProject.id, "country", v)}
                        onCreate={(raw) => handleCreatableCreate("countries", "country", raw)}
                        onOpenManage={() => setOptionManageField("countries")}
                        placeholder="COUNTRY"
                      />
                    </Field>

                    <Field label="CERTIFICATE">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.certificate}
                        options={selectOptions.certificates}
                        onChange={(v) => updateProjectField(selectedProject.id, "certificate", v)}
                        onCreate={(raw) => handleCreatableCreate("certificates", "certificate", raw)}
                        onOpenManage={() => setOptionManageField("certificates")}
                        placeholder="CERTIFICATE"
                      />
                    </Field>

                    <Field label="EXPORTER">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.exporter}
                        options={selectOptions.exporters}
                        onChange={(v) => updateProjectField(selectedProject.id, "exporter", v)}
                        onCreate={(raw) => handleCreatableCreate("exporters", "exporter", raw)}
                        onOpenManage={() => setOptionManageField("exporters")}
                        placeholder="EXPORTER"
                      />
                    </Field>

                    <Field label="CLIENT">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.client}
                        options={selectOptions.clients}
                        onChange={(v) => updateProjectField(selectedProject.id, "client", v)}
                        onCreate={(raw) => handleCreatableCreate("clients", "client", raw)}
                        onOpenManage={() => setOptionManageField("clients")}
                        placeholder="CLIENT"
                      />
                    </Field>

                    <Field label="BUSINESS MODEL">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.businessModel}
                        options={selectOptions.businessModels}
                        onChange={(v) => updateProjectField(selectedProject.id, "businessModel", v)}
                        onCreate={(raw) => handleCreatableCreate("businessModels", "businessModel", raw)}
                        onOpenManage={() => setOptionManageField("businessModels")}
                        placeholder="BUSINESS MODEL"
                      />
                    </Field>

                    <Field label="H.S CODE">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.hsCode}
                        options={selectOptions.hsCodes}
                        onChange={(v) => updateProjectField(selectedProject.id, "hsCode", v)}
                        onCreate={(raw) => handleCreatableCreate("hsCodes", "hsCode", raw)}
                        onOpenManage={() => setOptionManageField("hsCodes")}
                        placeholder="H.S CODE"
                      />
                    </Field>

                    <Field label="INCOTERMS">
                      <CreatableSelect
                        showAllClearOption
                        value={selectedProject.incoterms}
                        options={selectOptions.incoterms}
                        onChange={(v) => updateProjectField(selectedProject.id, "incoterms", v)}
                        onCreate={(raw) => handleCreatableCreate("incoterms", "incoterms", raw)}
                        onOpenManage={() => setOptionManageField("incoterms")}
                        placeholder="INCOTERMS"
                      />
                    </Field>

                    <Field label="CUSTOM">
                      <PercentInputField
                        value={selectedProject.customRate}
                        onChange={(v) => updateProjectField(selectedProject.id, "customRate", v)}
                        placeholder="8"
                      />
                    </Field>

                    <Field label="VAT">
                      <PercentInputField
                        value={selectedProject.vatRate}
                        onChange={(v) => updateProjectField(selectedProject.id, "vatRate", v)}
                        placeholder="10"
                      />
                    </Field>

                    <Field label="ETD">
                      <Input
                        type="date"
                        value={selectedProject.etd}
                        onChange={(v) => updateProjectField(selectedProject.id, "etd", v)}
                      />
                    </Field>

                    <Field label="ETA">
                      <Input
                        type="date"
                        value={selectedProject.eta}
                        onChange={(v) => updateProjectField(selectedProject.id, "eta", v)}
                      />
                    </Field>

                    <PriceField
                      label="PRICE"
                      value={selectedProject.priceValue}
                      currency={selectedProject.priceCurrency}
                      unit={selectedProject.priceUnit}
                      onValueChange={(v) => updateProjectField(selectedProject.id, "priceValue", v)}
                      onCurrencyChange={(v) => updateProjectField(selectedProject.id, "priceCurrency", v)}
                      onUnitChange={(v) => updateProjectField(selectedProject.id, "priceUnit", v)}
                      placeholder="7.9"
                    />

                    <PriceField
                      label="OFFER PRICE"
                      value={selectedProject.offerPriceValue}
                      currency={selectedProject.offerPriceCurrency}
                      unit={selectedProject.offerPriceUnit}
                      onValueChange={(v) => updateProjectField(selectedProject.id, "offerPriceValue", v)}
                      onCurrencyChange={(v) => updateProjectField(selectedProject.id, "offerPriceCurrency", v)}
                      onUnitChange={(v) => updateProjectField(selectedProject.id, "offerPriceUnit", v)}
                      placeholder="8.3"
                    />

                    <PriceField
                      label="FINAL PRICE"
                      value={selectedProject.finalPriceValue}
                      currency={selectedProject.finalPriceCurrency}
                      unit={selectedProject.finalPriceUnit}
                      onValueChange={(v) => updateProjectField(selectedProject.id, "finalPriceValue", v)}
                      onCurrencyChange={(v) => updateProjectField(selectedProject.id, "finalPriceCurrency", v)}
                      onUnitChange={(v) => updateProjectField(selectedProject.id, "finalPriceUnit", v)}
                      placeholder="7.6"
                    />
                  </div>

                  <details className="mb-4 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/80 px-3 py-1.5">
                    <summary className="cursor-pointer list-none text-[10px] font-medium text-neutral-500 marker:hidden [&::-webkit-details-marker]:hidden">
                      <span className="underline decoration-neutral-300 decoration-dotted underline-offset-2">
                        NOTE (선택 · 플로우 메모)
                      </span>
                    </summary>
                    <div className="mt-2 border-t border-neutral-200/80 pt-2">
                      <TextArea
                        value={selectedProject.note}
                        onChange={(v) =>
                          setProjects((prev) =>
                            prev.map((p) =>
                              p.id === selectedProject.id
                                ? { ...p, note: v, updated: true, lastChangedAt: nowString() }
                                : p
                            )
                          )
                        }
                        placeholder="필요할 때만 입력"
                        rows={2}
                      />
                    </div>
                  </details>
              </>


            <div className="flex flex-col gap-4">
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-neutral-200 bg-white p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Progress</div>
                  <div className="mt-2 text-[26px] font-black">
                    {selectedProgress.done}/{selectedProgress.total}
                  </div>
                  <div className="mt-3 h-2.5 rounded-full bg-neutral-200">
                    <div className="h-2.5 rounded-full bg-slate-900" style={{ width: `${selectedProgress.percent}%` }} />
                  </div>
                </div>

                <div className="rounded-[22px] border border-neutral-200 bg-white p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Next Due</div>
                  {selectedNextDue ? (
                    <>
                      <div className="mt-2 text-[15px] font-bold">{selectedNextDue.label}</div>
                      <div className="mt-1 text-sm text-neutral-500">{selectedNextDue.dueDate}</div>
                    </>
                  ) : (
                    <div className="mt-2 text-sm text-neutral-500">No due scheduled</div>
                  )}
                </div>

                <div className="rounded-[22px] border border-neutral-200 bg-white p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Overdue</div>
                  <div className={`mt-2 text-[26px] font-black ${selectedOverdueCount > 0 ? "text-rose-600" : "text-neutral-900"}`}>
                    {selectedOverdueCount}
                  </div>
                  <div className="mt-1 text-sm text-neutral-500">unchecked steps</div>
                </div>
              </section>

              <section className="rounded-[26px] border border-neutral-200 bg-white p-4 sm:p-5">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[13px] uppercase tracking-[0.2em] text-neutral-500">FLOWCHART</div>
                  <button
                    type="button"
                    disabled={dueReminderBusy}
                    onClick={() => {
                      void runDueReminderScan();
                    }}
                    className="shrink-0 rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2 text-xs font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {dueReminderBusy ? "Due 알림 검사 중…" : "Due 24h 알림 검사 (API)"}
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-neutral-200">
                  <div className="min-w-[1420px]">
                    <div
                      className="grid grid-cols-[36px_52px_44px_minmax(280px,360px)_150px_150px_150px_minmax(280px,1fr)_72px_72px] gap-x-2 border-b border-neutral-200 bg-[#f8f7f5] px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500"
                    >
                      <div />
                      <div className="text-center">N/A</div>
                      <div />
                      <div>Process</div>
                      <div>Due Date</div>
                      <div>Confirmed At</div>
                      <div>Assignee</div>
                      <div>Remark</div>
                      <div />
                      <div />
                    </div>

                    {buildAllFlowchartVisibleRows(selectedProject.phases).map(
                      ({ phaseId, step, depth, displayIndex, isChildRow }) => {
                        const overdue = !step.checked && !!step.dueDate && isOverdue(step.dueDate);
                        const dueSoonLabel = !step.checked && !overdue ? getDueSoonLabel(step.dueDate) : null;
                        const draft = stepDrafts[step.id] ?? stepToDraft(step);
                        const mentionQuery = extractMentionQuery(draft.memo);
                        const mentionCandidates =
                          mentionQuery !== null
                            ? globalMembers.filter(
                                (member) =>
                                  member.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                                  member.email.toLowerCase().includes(mentionQuery.toLowerCase())
                              )
                            : [];

                        const rowHighlight = highlightedStepId === step.id;
                        const rowSurface = step.notApplicable
                          ? rowHighlight
                            ? "bg-neutral-100/95 ring-2 ring-blue-200 ring-inset"
                            : isChildRow
                              ? "bg-neutral-100"
                              : "bg-neutral-50/90"
                          : overdue && rowHighlight
                            ? "bg-rose-50/60 ring-2 ring-blue-200 ring-inset"
                            : overdue
                              ? isChildRow
                                ? "bg-rose-50/70"
                                : "bg-rose-50/60"
                              : rowHighlight
                                ? "bg-blue-50/40 ring-2 ring-blue-200 ring-inset"
                                : isChildRow
                                  ? "bg-[#f1f1f1]"
                                  : "bg-white";

                        return (
                          <div
                            key={step.id}
                            id={`step-${step.id}`}
                            className={
                              "grid grid-cols-[36px_52px_44px_minmax(280px,360px)_150px_150px_150px_minmax(280px,1fr)_72px_72px] items-start gap-x-2 border-b border-neutral-200 px-2 py-1.5 " +
                              rowSurface
                            }
                          >
                            <div className="flex justify-center pt-1">
                              <input
                                type="checkbox"
                                checked={step.checked}
                                disabled={step.notApplicable}
                                onChange={(e) =>
                                  toggleStepChecked(selectedProject.id, phaseId, step.id, e.target.checked)
                                }
                                className="h-4 w-4 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label={`완료: ${step.label}`}
                              />
                            </div>
                            <div className="flex justify-center pt-1">
                              <input
                                type="checkbox"
                                checked={step.notApplicable}
                                onChange={(e) =>
                                  toggleStepNotApplicable(
                                    selectedProject.id,
                                    phaseId,
                                    step.id,
                                    e.target.checked
                                  )
                                }
                                className="h-4 w-4 accent-neutral-500"
                                aria-label={`해당 없음(N/A): ${step.label}`}
                              />
                            </div>
                            <div
                              className={`pt-1 text-center tabular-nums ${
                                isChildRow
                                  ? "text-sm font-semibold text-neutral-300"
                                  : "text-[15px] font-extrabold text-neutral-800"
                              }`}
                            >
                              {displayIndex || "\u00a0"}
                            </div>
                            <div
                              className="flex min-w-0 items-start gap-1.5 py-1 text-left text-[15px] font-medium text-neutral-900"
                              style={isChildRow ? { paddingLeft: 8 + Math.max(0, depth - 1) * 8 } : undefined}
                            >
                              {step.subSteps && step.subSteps.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleStepExpanded(selectedProject.id, phaseId, step.id)}
                                  className="h-7 w-7 shrink-0 rounded-md text-sm text-neutral-500 hover:bg-neutral-200/80 hover:text-neutral-800"
                                  aria-expanded={Boolean(step.expanded)}
                                  aria-label={step.expanded ? "하위 접기" : "하위 펼치기"}
                                >
                                  {step.expanded ? "▼" : "▶"}
                                </button>
                              ) : (
                                <span
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-neutral-300"
                                  aria-hidden
                                >
                                  ·
                                </span>
                              )}

                              {isChildRow ? (
                                <span className="shrink-0 text-[12px] font-semibold text-neutral-400">└</span>
                              ) : null}

                              <span
                                className={`min-w-0 ${
                                  isChildRow
                                    ? "text-[14px] font-medium text-neutral-700"
                                    : "text-[15px] font-extrabold tracking-[-0.02em] text-neutral-900"
                                }`}
                                style={{
                                  whiteSpace: "normal",
                                  overflowWrap: "anywhere",
                                  wordBreak: "keep-all",
                                  lineHeight: 1.25,
                                }}
                              >
                                {step.label}
                              </span>

                              {step.subSteps?.length ? (
                                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                                  {step.subSteps.length}
                                </span>
                              ) : null}

                              {step.notApplicable ? (
                                <span className="shrink-0 rounded border border-neutral-200 bg-neutral-100/90 px-1 py-0.5 text-[10px] font-semibold text-neutral-600">
                                  N/A
                                </span>
                              ) : null}

                              {overdue ? (
                                <span className="shrink-0 rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-[10px] font-semibold text-rose-700">
                                  OVERDUE
                                </span>
                              ) : null}

                              {!overdue && dueSoonLabel ? (
                                <span className="shrink-0 rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  {dueSoonLabel}
                                </span>
                              ) : null}
                            </div>
                            <div className="rounded border border-neutral-200 px-1.5 py-1 pt-1.5">
                              <Input
                                type="date"
                                value={draft.dueDate}
                                onChange={(v) => patchStepDraft(step.id, { dueDate: v }, step)}
                                className="text-[14px]"
                              />
                            </div>
                            <div className="rounded border border-neutral-200 px-1.5 py-1 pt-1.5">
                              <Input
                                type="date"
                                value={draft.confirmedAt}
                                onChange={(v) => patchStepDraft(step.id, { confirmedAt: v }, step)}
                                className="text-[14px]"
                              />
                            </div>
                            <div className="min-w-0 pt-1">
                              <AssigneeMultiSelect
                                compact
                                members={globalMembers}
                                selectedIds={draft.assigneeMemberIds}
                                onChange={(next) => patchStepDraft(step.id, { assigneeMemberIds: next }, step)}
                              />
                            </div>
                            <div className="relative min-w-0 pt-1">
                              <TextArea
                                value={draft.memo}
                                onChange={(v) => patchStepDraft(step.id, { memo: v }, step)}
                                placeholder="@멘션 · 확인 시 저장"
                                rows={2}
                                className="min-h-[38px] py-1 text-[13px] leading-snug"
                              />
                              {mentionQuery !== null && mentionCandidates.length > 0 && (
                                <div className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg">
                                  {mentionCandidates.map((member) => (
                                    <button
                                      key={member.id}
                                      type="button"
                                      onClick={() => applyMentionToDraft(step.id, member, step)}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
                                    >
                                      <MemberInitial name={member.name} />
                                      <span className="truncate font-medium">{member.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex justify-center pt-1">
                              <button
                                type="button"
                                onClick={() => resetStepDraftFields(step.id)}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-medium text-rose-700"
                              >
                                초기화
                              </button>
                            </div>
                            <div className="flex justify-center pt-1">
                              <button
                                type="button"
                                disabled={savingStepId === step.id}
                                onClick={() => void saveStepDraft(selectedProject.id, phaseId, step.id)}
                                className="rounded-lg border border-slate-900 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingStepId === step.id ? "…" : "확인"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </section>
            </div>


            <section className="space-y-4">
              <section className="rounded-[26px] border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Update Log</div>
                    <h2 className="text-[20px] font-bold tracking-[-0.03em]">Email Log</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEmailLogOpen((prev) => !prev)}
                    className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium"
                  >
                    {emailLogOpen ? "Hide" : "Show"}
                  </button>
                </div>

                {emailLogOpen ? (
                  <div className="space-y-2">
                    {selectedProject.notificationLogs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-neutral-200 bg-[#faf9f7] px-3 py-4 text-center text-xs text-neutral-400">
                        아직 이메일 알림 로그가 없습니다.
                      </div>
                    ) : (
                      selectedProject.notificationLogs.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-xl border border-neutral-200 bg-[#faf9f7] px-3 py-2.5"
                        >
                          <div className="text-sm font-semibold leading-tight">{log.stepLabel}</div>
                          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0 text-xs text-neutral-500">
                            <span>{log.phaseTitle}</span>
                            <span className="text-neutral-400">{log.createdAt}</span>
                          </div>
                          <div className="mt-1 text-xs leading-snug text-neutral-600">
                            {log.kind === "due_reminder" ? (
                              <>
                                <span className="font-medium">{log.authorName}</span>
                                {log.recipients.length > 0
                                  ? ` → ${log.recipients.map((r) => `${r.name} (${r.email})`).join(", ")}`
                                  : null}
                              </>
                            ) : (
                              <>
                                <span className="font-medium">{log.authorName}</span> mentioned{" "}
                                {log.recipients.map((r) => `@${r.name}`).join(", ")}
                              </>
                            )}
                          </div>
                          <div className="mt-1 text-sm leading-snug text-neutral-700">{log.commentText}</div>
                          {log.stepLink ? (
                            <div className="mt-2">
                              <a
                                href={log.stepLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 underline-offset-2 hover:bg-slate-50 hover:underline"
                              >
                                열기
                              </a>
                            </div>
                          ) : null}
                          {log.emailNotify && (
                            <div className="mt-1.5 border-t border-neutral-200/90 pt-1.5 text-[11px] leading-snug text-neutral-600">
                              <div
                                className={
                                  log.emailNotify.overallOk ? "font-medium text-emerald-700" : "font-medium text-rose-700"
                                }
                              >
                                이메일:{" "}
                                {log.emailNotify.mock ? "[MOCK] " : ""}
                                {log.emailNotify.overallOk ? "발송 성공" : "발송 실패"}
                                {log.emailNotify.attemptedAt ? ` · ${log.emailNotify.attemptedAt}` : ""}
                              </div>
                              {log.emailNotify.overallError ? (
                                <div className="mt-0.5 text-rose-600">{log.emailNotify.overallError}</div>
                              ) : null}
                              {log.emailNotify.perRecipient.some((r) => !r.ok) ? (
                                <ul className="mt-0.5 list-inside list-disc text-neutral-500">
                                  {log.emailNotify.perRecipient
                                    .filter((r) => !r.ok)
                                    .map((r) => (
                                      <li key={r.email}>
                                        {r.name} ({r.email}){r.error ? ` — ${r.error}` : ""}
                                      </li>
                                    ))}
                                </ul>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </section>
            </section>
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center px-6">
                <div className="rounded-[28px] border border-dashed border-neutral-200 bg-white px-8 py-12 text-center text-sm text-neutral-500">
                  선택된 프로젝트가 없습니다. 왼쪽 목록에서 프로젝트를 선택하거나 NEW로 추가하세요.
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}