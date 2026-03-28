"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildDueReminderProcessRequest,
  type DueReminderJobResult,
  type DueReminderProcessResponse,
} from "@/lib/due-reminder-email";
import { type MentionNotifyResponse } from "@/lib/mention-email";

type ProjectStatus = "REVIEW" | "IN PROGRESS" | "HOLD" | "DONE" | "DRAFT";
type SortOption = "UPDATED_DESC" | "CODE_ASC" | "CODE_DESC" | "PROGRESS_DESC";
type FormMode = "create" | "edit";
type MemberRole = "관리자" | "사용자";

type Member = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
};

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
  dueDate: string;
  /** 마감 24시간 전 알림 발송 시각(ISO). 비어 있으면 미발송 */
  dueReminderSentAt: string;
  confirmedAt: string;
  memo: string;
  assigneeMemberId: string;
  comments: StepComment[];
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
  exporter: string;
  item: string;
  client: string;
  note: string;
  updated: boolean;
  lastChangedAt: string;
  phases: Phase[];
  notificationLogs: NotificationLog[];
};

type ProjectForm = {
  code: string;
  status: ProjectStatus;
  country: string;
  exporter: string;
  item: string;
  client: string;
  note: string;
};

type MemberForm = {
  name: string;
  email: string;
  role: MemberRole;
};

type PersistedState = {
  projects: Project[];
  selectedId: string;
  globalMembers: Member[];
};

const STORAGE_KEY = "flowchart-dashboard-v4";

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
  return raw.filter((m): m is Member => {
    if (!m || typeof m !== "object") return false;
    const o = m as Record<string, unknown>;
    return (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      typeof o.email === "string" &&
      (o.role === "관리자" || o.role === "사용자")
    );
  });
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

const ITEM_OPTIONS = [
  "GREEN BEAN",
  "INSTANT COFFEE",
  "DECAF GREEN",
  "TEA EXTRACT",
  "TEMPLATE",
  "OTHER",
];

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

function toDatetimeLocal(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function isoNowLocal() {
  return toDatetimeLocal(new Date());
}

function parseDateSafe(value: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isOverdue(value: string) {
  const d = parseDateSafe(value);
  if (!d) return false;
  return d.getTime() < Date.now();
}

function emptyForm(): ProjectForm {
  return {
    code: "",
    status: "DRAFT",
    country: "",
    exporter: "",
    item: "GREEN BEAN",
    client: "",
    note: "",
  };
}

function emptyMemberForm(): MemberForm {
  return {
    name: "",
    email: "",
    role: "사용자",
  };
}

function createMember(name: string, email: string, role: MemberRole): Member {
  return {
    id: createId("member"),
    name,
    email,
    role,
  };
}

function createStep(label: string): Step {
  return {
    id: createId("step"),
    label,
    checked: false,
    dueDate: "",
    dueReminderSentAt: "",
    confirmedAt: "",
    memo: "",
    assigneeMemberId: "",
    comments: [],
  };
}

function createPhase(title: string, stepLabels: string[], expanded = false): Phase {
  return {
    id: createId("phase"),
    title,
    expanded,
    steps: stepLabels.map((label) => createStep(label)),
  };
}

function createFixedFlowchartPhases(): Phase[] {
  return [
    createPhase("PHASE 1 — Planning", [
      "1. Business Model Check",
      "2. Import Availability",
      "3. Pricing",
    ]),
    createPhase("PHASE 2 — Ordering", [
      "4. Overseas Order",
      "5. PSS Test",
      "6. Packing & Label",
    ]),
    createPhase("PHASE 3 — Shipping", [
      "7. Booking",
      "8. Shipping Document",
      "9. Payment",
    ]),
    createPhase("PHASE 4 — Clearance", [
      "10. Arrival",
      "11. Inspection",
      "12. Clearance",
    ]),
    createPhase("PHASE 5 — Closing", [
      "13. Warehouse",
      "14. Invoice",
      "15. Feedback",
    ]),
  ];
}

/** 저장본에 남아 있을 수 있는 레거시 필드 제거 후 Project로 복원 */
function projectFromStorage(raw: unknown): Project {
  const p = { ...(raw as Record<string, unknown>) };
  delete p.projectMemberIds;
  return makeProject(p as Partial<Project>);
}

function sanitizeAssigneesAgainstMembers(projects: Project[], validMemberIds: Set<string>): Project[] {
  return projects.map((project) => ({
    ...project,
    phases: project.phases.map((phase) => ({
      ...phase,
      steps: phase.steps.map((step) =>
        step.assigneeMemberId && !validMemberIds.has(step.assigneeMemberId)
          ? { ...step, assigneeMemberId: "" }
          : step
      ),
    })),
  }));
}

function normalizeStepFromStorage(step: Step): Step {
  return {
    ...step,
    dueReminderSentAt: step.dueReminderSentAt ?? "",
  };
}

function normalizePhasesFromStorage(phases: Phase[]): Phase[] {
  return phases.map((phase) => ({
    ...phase,
    steps: phase.steps.map(normalizeStepFromStorage),
  }));
}

function makeProject(data?: Partial<Project>): Project {
  const rawPhases = data?.phases ?? createFixedFlowchartPhases();
  return {
    id: data?.id ?? createId("project"),
    code: data?.code ?? "DRAFT",
    status: data?.status ?? "DRAFT",
    country: data?.country ?? "",
    exporter: data?.exporter ?? "",
    item: data?.item ?? "GREEN BEAN",
    client: data?.client ?? "",
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
  const steps = project.phases.flatMap((phase) => phase.steps);
  const total = steps.length;
  const done = steps.filter((step) => step.checked).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}

function getNextDueStep(project: Project) {
  const steps = project.phases.flatMap((phase) =>
    phase.steps
      .filter((step) => !step.checked && step.dueDate)
      .map((step) => ({
        phaseTitle: phase.title,
        ...step,
      }))
  );

  if (!steps.length) return null;

  return steps.sort((a, b) => {
    const aTime = parseDateSafe(a.dueDate)?.getTime() ?? Infinity;
    const bTime = parseDateSafe(b.dueDate)?.getTime() ?? Infinity;
    return aTime - bTime;
  })[0];
}

function getOverdueCount(project: Project) {
  return project.phases
    .flatMap((phase) => phase.steps)
    .filter((step) => !step.checked && step.dueDate && isOverdue(step.dueDate)).length;
}

function getPhaseOverdueCount(phase: Phase) {
  return phase.steps.filter((step) => !step.checked && step.dueDate && isOverdue(step.dueDate)).length;
}

function badgeStyle(status: ProjectStatus) {
  if (status === "REVIEW") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "IN PROGRESS") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "HOLD") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "DONE") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function itemPillStyle(item: string) {
  if (item === "GREEN BEAN") return "bg-[#dfe9df] text-[#43624b]";
  if (item === "INSTANT COFFEE") return "bg-[#e8e1e5] text-[#4f4c4d]";
  if (item === "DECAF GREEN") return "bg-[#e8def4] text-[#6d558a]";
  if (item === "TEA EXTRACT") return "bg-[#dde8dc] text-[#496150]";
  if (item === "TEMPLATE") return "bg-[#ece2c6] text-[#7a6934]";
  return "bg-neutral-100 text-neutral-700";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <input
      value={value}
      type={type}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400 read-only:cursor-default"
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full resize-none bg-transparent text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent text-[14px] text-neutral-900 outline-none"
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

function applyDueReminderJobResults(prev: Project[], results: DueReminderJobResult[]): Project[] {
  const ok = results.filter((r) => r.ok && r.sentAt);
  if (!ok.length) return prev;
  const sentAtByStep = new Map(ok.map((r) => [`${r.projectId}\t${r.phaseId}\t${r.stepId}`, r.sentAt]));
  return prev.map((project) => {
    let projectTouched = false;
    const phases = project.phases.map((phase) => ({
      ...phase,
      steps: phase.steps.map((step) => {
        const key = `${project.id}\t${phase.id}\t${step.id}`;
        const sentAt = sentAtByStep.get(key);
        if (!sentAt || step.dueReminderSentAt === sentAt) return step;
        projectTouched = true;
        return { ...step, dueReminderSentAt: sentAt };
      }),
    }));
    return projectTouched
      ? { ...project, phases, updated: true, lastChangedAt: nowString() }
      : project;
  });
}

export default function Page() {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [selectedId, setSelectedId] = useState<string>(initialProjects[0]?.id ?? "");

  const [globalMembers, setGlobalMembers] = useState<Member[]>([]);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>(emptyForm());

  const [memberForm, setMemberForm] = useState<MemberForm>(emptyMemberForm());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [itemFilter, setItemFilter] = useState("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");
  const [exporterFilter, setExporterFilter] = useState("ALL");
  const [overdueFilter, setOverdueFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("UPDATED_DESC");

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentOpenMap, setCommentOpenMap] = useState<Record<string, boolean>>({});
  const [savingCommentStepId, setSavingCommentStepId] = useState<string | null>(null);
  const [dueReminderBusy, setDueReminderBusy] = useState(false);
  /** localStorage에서 첫 복원이 끝나기 전에는 저장하지 않음(초기 상태로 덮어쓰기 방지) */
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = parsePersistedJson(raw);
      if (!parsed) return;

      const members = normalizeStoredMembers(parsed.globalMembers);
      const memberIds = new Set(members.map((m) => m.id));

      if (Array.isArray(parsed.projects)) {
        const restored = normalizeStoredProjects(parsed.projects);
        const next = sanitizeAssigneesAgainstMembers(restored, memberIds);
        if (!cancelled) {
          setGlobalMembers(members);
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
      } else if (!cancelled) {
        setGlobalMembers(members);
      }
    } catch {
      // 손상된 JSON 등 — 초기 상태 유지
    } finally {
      if (!cancelled) setStorageReady(true);
    }

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
        globalMembers,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 할당량 초과 등
    }
  }, [projects, selectedId, globalMembers, storageReady]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? projects[0] ?? null,
    [projects, selectedId]
  );

  const countryOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(projects.map((p) => p.country))).filter(Boolean)],
    [projects]
  );

  const itemOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(projects.map((p) => p.item))).filter(Boolean)],
    [projects]
  );

  const clientOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(projects.map((p) => p.client))).filter(Boolean)],
    [projects]
  );

  const exporterOptions = useMemo(
    () => ["ALL", ...Array.from(new Set(projects.map((p) => p.exporter))).filter(Boolean)],
    [projects]
  );

  const filteredProjects = useMemo(() => {
    const result = [...projects].filter((project) => {
      const q = search.trim().toLowerCase();

      const searchOk =
        !q ||
        [project.code, project.country, project.exporter, project.item, project.client, project.note]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const statusOk = statusFilter === "ALL" || project.status === statusFilter;
      const countryOk = countryFilter === "ALL" || project.country === countryFilter;
      const itemOk = itemFilter === "ALL" || project.item === itemFilter;
      const clientOk = clientFilter === "ALL" || project.client === clientFilter;
      const exporterOk = exporterFilter === "ALL" || project.exporter === exporterFilter;

      const overdueCount = getOverdueCount(project);
      const overdueOk =
        overdueFilter === "ALL" ||
        (overdueFilter === "YES" && overdueCount > 0) ||
        (overdueFilter === "NO" && overdueCount === 0);

      return searchOk && statusOk && countryOk && itemOk && clientOk && exporterOk && overdueOk;
    });

    result.sort((a, b) => {
      if (sortBy === "CODE_ASC") return a.code.localeCompare(b.code);
      if (sortBy === "CODE_DESC") return b.code.localeCompare(a.code);
      if (sortBy === "PROGRESS_DESC") return getProjectProgress(b).percent - getProjectProgress(a).percent;
      return b.lastChangedAt.localeCompare(a.lastChangedAt);
    });

    return result;
  }, [
    projects,
    search,
    statusFilter,
    countryFilter,
    itemFilter,
    clientFilter,
    exporterFilter,
    overdueFilter,
    sortBy,
  ]);

  function updateFormField<K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateMemberFormField<K extends keyof MemberForm>(key: K, value: MemberForm[K]) {
    setMemberForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreatePanel() {
    setFormMode("create");
    setEditingId(null);
    setForm({
      ...emptyForm(),
      code: "DRAFT",
    });
    setPanelOpen(true);
  }

  function openEditPanel(project: Project) {
    setFormMode("edit");
    setEditingId(project.id);
    setForm({
      code: project.code,
      status: project.status,
      country: project.country,
      exporter: project.exporter,
      item: project.item,
      client: project.client,
      note: project.note,
    });
    setPanelOpen(true);
  }

  function saveProject() {
    const code = form.code.trim() || "DRAFT";

    if (formMode === "create") {
      const duplicate = projects.some((project) => project.code.toLowerCase() === code.toLowerCase());
      if (duplicate) {
        alert("중복 CODE입니다. 다른 CODE를 입력해주세요.");
        return;
      }

      const newProject = makeProject({
        code,
        status: form.status,
        country: form.country.trim().toUpperCase(),
        exporter: form.exporter.trim(),
        item: form.item.trim().toUpperCase(),
        client: form.client.trim(),
        note: form.note.trim(),
        updated: true,
        lastChangedAt: nowString(),
        phases: createFixedFlowchartPhases(),
        notificationLogs: [],
      });

      setProjects((prev) => [newProject, ...prev]);
      setSelectedId(newProject.id);
      setPanelOpen(false);
      setForm(emptyForm());
      return;
    }

    if (formMode === "edit" && editingId) {
      const duplicate = projects.some(
        (project) => project.id !== editingId && project.code.toLowerCase() === code.toLowerCase()
      );
      if (duplicate) {
        alert("다른 프로젝트가 이미 같은 CODE를 사용 중입니다.");
        return;
      }

      setProjects((prev) =>
        prev.map((project) =>
          project.id === editingId
            ? {
                ...project,
                code,
                status: form.status,
                country: form.country.trim().toUpperCase(),
                exporter: form.exporter.trim(),
                item: form.item.trim().toUpperCase(),
                client: form.client.trim(),
                note: form.note.trim(),
                updated: true,
                lastChangedAt: nowString(),
              }
            : project
        )
      );

      setPanelOpen(false);
      setEditingId(null);
      setForm(emptyForm());
    }
  }

  function deleteSelectedProject() {
    if (!selectedProject) return;
    const ok = window.confirm(`${selectedProject.code} 프로젝트를 삭제할까요?`);
    if (!ok) return;

    const next = projects.filter((project) => project.id !== selectedProject.id);
    setProjects(next);
    setSelectedId(next[0]?.id ?? "");
    setPanelOpen(false);
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
                  steps: phase.steps.map((step) => {
                    if (step.id !== stepId) return step;
                    const next: Step = { ...step, ...patch };
                    if (patch.dueDate !== undefined && patch.dueDate !== step.dueDate) {
                      next.dueReminderSentAt = "";
                    }
                    if (patch.assigneeMemberId !== undefined && patch.assigneeMemberId !== step.assigneeMemberId) {
                      next.dueReminderSentAt = "";
                    }
                    return next;
                  }),
                }
          ),
        };
      })
    );
  }

  function toggleStepChecked(projectId: string, phaseId: string, stepId: string, checked: boolean) {
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
                  steps: phase.steps.map((step) =>
                    step.id === stepId
                      ? {
                          ...step,
                          checked,
                          confirmedAt: checked ? isoNowLocal() : "",
                          dueReminderSentAt: checked ? "" : step.dueReminderSentAt,
                        }
                      : step
                  ),
                }
          ),
        };
      })
    );
  }

  function togglePhase(projectId: string, phaseId: string) {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        return {
          ...project,
          phases: project.phases.map((phase) =>
            phase.id === phaseId ? { ...phase, expanded: !phase.expanded } : phase
          ),
        };
      })
    );
  }

  function addGlobalMember() {
    const name = memberForm.name.trim();
    const email = memberForm.email.trim();

    if (!name) {
      alert("멤버 이름을 입력해주세요.");
      return;
    }

    if (!email) {
      alert("멤버 이메일을 입력해주세요.");
      return;
    }

    const duplicate = globalMembers.some((member) => member.email.toLowerCase() === email.toLowerCase());
    if (duplicate) {
      alert("이미 같은 이메일의 멤버가 있습니다.");
      return;
    }

    setGlobalMembers((prev) => [...prev, createMember(name, email, memberForm.role)]);
    setMemberForm(emptyMemberForm());
  }

  function removeGlobalMember(memberId: string) {
    setGlobalMembers((prev) => prev.filter((member) => member.id !== memberId));

    setProjects((prev) =>
      prev.map((project) => ({
        ...project,
        phases: project.phases.map((phase) => ({
          ...phase,
          steps: phase.steps.map((step) =>
            step.assigneeMemberId === memberId ? { ...step, assigneeMemberId: "" } : step
          ),
        })),
      }))
    );
  }

  function toggleCommentOpen(stepId: string) {
    setCommentOpenMap((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  }

  function setCommentDraft(stepId: string, value: string) {
    setCommentDrafts((prev) => ({
      ...prev,
      [stepId]: value,
    }));
  }

  function applyMention(stepId: string, member: Member) {
    const current = commentDrafts[stepId] ?? "";
    const query = extractMentionQuery(current);
    if (query === null) return;

    const replaced = current.replace(/@([^\s@]*)$/, `@${member.name} `);
    setCommentDraft(stepId, replaced);
  }

  async function addCommentWithMentions(projectId: string, phaseId: string, stepId: string) {
    const draft = (commentDrafts[stepId] ?? "").trim();
    if (!draft || !selectedProject) return;
    if (savingCommentStepId) return;

    const mentionedMembers = globalMembers.filter((member) => draft.includes(`@${member.name}`));

    const mentions: Mention[] = mentionedMembers.map((member) => ({
      memberId: member.id,
      name: member.name,
      email: member.email,
    }));

    const currentPhase = selectedProject.phases.find((phase) => phase.id === phaseId);
    const currentStep = currentPhase?.steps.find((step) => step.id === stepId);
    const commentCreatedAt = nowString();

    setSavingCommentStepId(stepId);
    let emailNotify: NotificationLog["emailNotify"];

    try {
      if (mentions.length) {
        try {
          const res = await fetch("/api/notify-mention", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipients: mentions.map((m) => ({ email: m.email, name: m.name })),
              projectCode: selectedProject.code,
              stepLabel: currentStep?.label ?? "",
              phaseTitle: currentPhase?.title ?? "",
              authorName: "나",
              commentText: draft,
              createdAt: commentCreatedAt,
            }),
          });

          const data = (await res.json()) as MentionNotifyResponse & { error?: string };
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
          const msg = e instanceof Error ? e.message : "알 수 없는 오류";
          emailNotify = {
            attemptedAt: nowString(),
            mock: true,
            overallOk: false,
            overallError: msg,
            perRecipient: mentions.map((m) => ({
              email: m.email,
              name: m.name,
              ok: false,
              error: msg,
            })),
          };
        }
      }

      const comment: StepComment = {
        id: createId("comment"),
        authorName: "나",
        message: draft,
        mentions,
        createdAt: commentCreatedAt,
      };

      const newLogs: NotificationLog[] = mentions.length
        ? [
            {
              id: createId("log"),
              kind: "mention",
              projectCode: selectedProject.code,
              phaseTitle: currentPhase?.title ?? "",
              stepLabel: currentStep?.label ?? "",
              authorName: "나",
              commentText: draft,
              recipients: mentions,
              createdAt: commentCreatedAt,
              emailNotify,
            },
          ]
        : [];

      setProjects((prev) =>
        prev.map((project) => {
          if (project.id !== projectId) return project;
          return {
            ...project,
            updated: true,
            lastChangedAt: nowString(),
            notificationLogs: [...newLogs, ...project.notificationLogs],
            phases: project.phases.map((phase) =>
              phase.id !== phaseId
                ? phase
                : {
                    ...phase,
                    steps: phase.steps.map((step) =>
                      step.id === stepId
                        ? {
                            ...step,
                            comments: [comment, ...step.comments],
                          }
                        : step
                    ),
                  }
            ),
          };
        })
      );

      setCommentDraft(stepId, "");
    } finally {
      setSavingCommentStepId(null);
    }
  }

  async function runDueReminderScan() {
    if (dueReminderBusy) return;
    setDueReminderBusy(true);
    try {
      const body = buildDueReminderProcessRequest(
        projects.map((p) => ({
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
              dueReminderSentAt: s.dueReminderSentAt,
            })),
          })),
        })),
        globalMembers.map((m) => ({ id: m.id, name: m.name, email: m.email }))
      );

      const res = await fetch("/api/due-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as DueReminderProcessResponse & { error?: string };
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
          const step = phase?.steps.find((s) => s.id === r.stepId);
          if (!phase || !step) continue;
          const assignee = globalMembers.find((m) => m.id === step.assigneeMemberId);

          const attemptedAt = r.sentAt || new Date().toISOString();
          const log: NotificationLog = {
            id: createId("log"),
            kind: "due_reminder",
            projectCode: proj.code,
            phaseTitle: phase.title,
            stepLabel: step.label,
            authorName: "Due Reminder",
            commentText: `Due 24h 알림 · 마감: ${step.dueDate.replace("T", " ")}`,
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

  return (
    <div className="min-h-screen bg-[#f6f5f3] text-neutral-900">
      <div className="mx-auto flex max-w-[1880px] gap-4 px-4 py-4">
        <aside className="sticky top-4 h-[calc(100vh-2rem)] w-[340px] shrink-0 overflow-hidden rounded-[28px] border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-5 py-5">
            <div className="mb-1 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Dashboard</div>
            <div className="text-[30px] font-black tracking-[-0.05em]">FLOWCHART TEST</div>
            <div className="mt-2 text-sm text-neutral-500">코드 중심 리스트 + 고정 15단계 플로우</div>
          </div>

          <div className="border-b border-neutral-200 px-4 py-4">
            <button
              onClick={() => setMemberPanelOpen((prev) => !prev)}
              className="mb-3 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold"
            >
              {memberPanelOpen ? "Hide Members" : "Show Members"}
            </button>

            {memberPanelOpen && (
              <div className="mb-3 overflow-hidden rounded-[22px] border border-neutral-200 bg-[#f8f7f5]">
                <div className="border-b border-neutral-200 px-3 py-3 text-sm font-semibold">Global Members</div>

                <div className="max-h-[38vh] space-y-3 overflow-y-auto p-3">
                  <Field label="NAME">
                    <Input
                      value={memberForm.name}
                      onChange={(v) => updateMemberFormField("name", v)}
                      placeholder="멤버 이름"
                    />
                  </Field>

                  <Field label="EMAIL">
                    <Input
                      value={memberForm.email}
                      onChange={(v) => updateMemberFormField("email", v)}
                      placeholder="example@email.com"
                    />
                  </Field>

                  <Field label="ROLE">
                    <Select
                      value={memberForm.role}
                      onChange={(v) => updateMemberFormField("role", v as MemberRole)}
                      options={["관리자", "사용자"]}
                    />
                  </Field>

                  <button
                    onClick={addGlobalMember}
                    className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                  >
                    + Add Member
                  </button>

                  <div className="space-y-2">
                    {globalMembers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-5 text-center text-sm text-neutral-400">
                        등록된 전역 멤버가 없습니다.
                      </div>
                    ) : (
                      globalMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-3"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <MemberInitial name={member.name} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{member.name}</div>
                              <div className="truncate text-xs text-neutral-500">{member.email}</div>
                            </div>
                          </div>

                          <button
                            onClick={() => removeGlobalMember(member.id)}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700"
                          >
                            삭제
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={openCreatePanel}
              className="mb-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              + New Project
            </button>

            {panelOpen && (
              <div className="mb-3 overflow-hidden rounded-[22px] border border-neutral-200 bg-[#f8f7f5]">
                <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-3">
                  <div className="text-sm font-semibold">
                    {formMode === "create" ? "Create Project" : "Edit Project"}
                  </div>
                  <button
                    onClick={() => {
                      setPanelOpen(false);
                      setEditingId(null);
                      setForm(emptyForm());
                    }}
                    className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium"
                  >
                    Close
                  </button>
                </div>

                <div className="max-h-[55vh] space-y-3 overflow-y-auto p-3">
                  <Field label="CODE">
                    <Input
                      value={form.code}
                      onChange={(v) => updateFormField("code", v)}
                      placeholder="예: DRAFT 또는 TATAMA-84"
                    />
                  </Field>

                  <Field label="STATUS">
                    <Select
                      value={form.status}
                      onChange={(v) => updateFormField("status", v as ProjectStatus)}
                      options={["DRAFT", "REVIEW", "IN PROGRESS", "HOLD", "DONE"]}
                    />
                  </Field>

                  <Field label="COUNTRY">
                    <Input
                      value={form.country}
                      onChange={(v) => updateFormField("country", v)}
                      placeholder="COUNTRY"
                    />
                  </Field>

                  <Field label="EXPORTER">
                    <Input
                      value={form.exporter}
                      onChange={(v) => updateFormField("exporter", v)}
                      placeholder="EXPORTER"
                    />
                  </Field>

                  <Field label="ITEM">
                    <Select value={form.item} onChange={(v) => updateFormField("item", v)} options={ITEM_OPTIONS} />
                  </Field>

                  <Field label="CLIENT">
                    <Input
                      value={form.client}
                      onChange={(v) => updateFormField("client", v)}
                      placeholder="CLIENT"
                    />
                  </Field>

                  <Field label="NOTE">
                    <TextArea
                      value={form.note}
                      onChange={(v) => updateFormField("note", v)}
                      placeholder="NOTE"
                      rows={4}
                    />
                  </Field>
                </div>

                <div className="border-t border-neutral-200 bg-[#f8f7f5] p-3">
                  <button
                    onClick={saveProject}
                    type="button"
                    className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold"
                  >
                    {formMode === "create" ? "Create Project" : "Save Changes"}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-4 py-3">
              <Input value={search} onChange={setSearch} placeholder="Search code / exporter / item / client" />
            </div>

            <button
              onClick={() => setFilterOpen((prev) => !prev)}
              className="mt-3 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold"
            >
              {filterOpen ? "Hide Filters" : "Show Filters"}
            </button>

            {filterOpen && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Status</div>
                  <Select
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={["ALL", "DRAFT", "REVIEW", "IN PROGRESS", "HOLD", "DONE"]}
                  />
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Country</div>
                  <Select value={countryFilter} onChange={setCountryFilter} options={countryOptions} />
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Item</div>
                  <Select value={itemFilter} onChange={setItemFilter} options={itemOptions} />
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Client</div>
                  <Select value={clientFilter} onChange={setClientFilter} options={clientOptions} />
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Exporter</div>
                  <Select value={exporterFilter} onChange={setExporterFilter} options={exporterOptions} />
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Sort</div>
                  <Select
                    value={sortBy}
                    onChange={(v) => setSortBy(v as SortOption)}
                    options={["UPDATED_DESC", "CODE_ASC", "CODE_DESC", "PROGRESS_DESC"]}
                  />
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2 col-span-2">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Overdue</div>
                  <Select value={overdueFilter} onChange={setOverdueFilter} options={["ALL", "YES", "NO"]} />
                </div>
              </div>
            )}
          </div>

          <div className="max-h-[calc(100vh-20rem)] overflow-y-auto px-3 py-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="text-sm font-semibold text-neutral-700">Projects</div>
              <div className="text-xs text-neutral-500">{filteredProjects.length}</div>
            </div>

            <div className="space-y-2">
              {filteredProjects.map((project) => {
                const selected = project.id === selectedId;
                const overdueCount = getOverdueCount(project);
                const progress = getProjectProgress(project);

                return (
                  <button
                    key={project.id}
                    onClick={() => setSelectedId(project.id)}
                    className={`group w-full rounded-[20px] border px-4 py-4 text-left transition ${
                      selected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-neutral-200 bg-white hover:border-neutral-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[22px] font-black tracking-[-0.04em]">{project.code}</div>

                        <div
                          className={`overflow-hidden transition-all duration-200 ${
                            selected
                              ? "mt-2 max-h-16 opacity-100"
                              : "mt-0 max-h-0 opacity-0 group-hover:mt-2 group-hover:max-h-16 group-hover:opacity-100"
                          }`}
                        >
                          <div className={`text-xs ${selected ? "text-white/75" : "text-neutral-500"}`}>
                            {project.exporter || "-"} · {project.client || "-"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        {project.updated && (
                          <span className={`h-2.5 w-2.5 rounded-full ${selected ? "bg-emerald-300" : "bg-emerald-500"}`} />
                        )}
                        {overdueCount > 0 && (
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                              selected ? "bg-rose-400/20 text-rose-100" : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {overdueCount}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className={`mt-3 h-1.5 rounded-full ${selected ? "bg-white/15" : "bg-neutral-200"}`}>
                      <div
                        className={`h-1.5 rounded-full ${selected ? "bg-white" : "bg-slate-900"}`}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {selectedProject ? (
            <>
              <section className="mb-4 rounded-[26px] border border-neutral-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Selected Project</div>

                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-[34px] font-black tracking-[-0.05em]">{selectedProject.code}</h1>
                      <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${badgeStyle(selectedProject.status)}`}>
                        {selectedProject.status}
                      </span>
                      <span className={`rounded-md px-3 py-1.5 text-[11px] font-semibold ${itemPillStyle(selectedProject.item)}`}>
                        {selectedProject.item}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-5">
                      <div className="rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Country</div>
                        <div className="mt-1 text-[14px] font-semibold">{selectedProject.country || "-"}</div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Exporter</div>
                        <div className="mt-1 text-[14px] font-semibold">{selectedProject.exporter || "-"}</div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Client</div>
                        <div className="mt-1 text-[14px] font-semibold">{selectedProject.client || "-"}</div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Progress</div>
                        <div className="mt-1 text-[14px] font-semibold">{selectedProgress.percent}%</div>
                      </div>

                      <div className="rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Last Updated</div>
                        <div className="mt-1 text-[14px] font-semibold">{selectedProject.lastChangedAt}</div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-[18px] border border-dashed border-neutral-200 bg-[#faf9f7] px-4 py-3 text-[14px] text-neutral-600">
                      {selectedProject.note || "NOTE 비어있음"}
                    </div>
                  </div>

                  <div className="w-full xl:w-[220px]">
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={() => openEditPanel(selectedProject)}
                        className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium"
                      >
                        Edit Project
                      </button>

                      <button
                        onClick={deleteSelectedProject}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                      >
                        Delete Project
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">
                  <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
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
                          <div className="mt-1 text-sm text-neutral-500">{selectedNextDue.dueDate.replace("T", " ")}</div>
                          <div className="mt-1 text-xs text-neutral-400">{selectedNextDue.phaseTitle}</div>
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

                  <section className="rounded-[26px] border border-neutral-200 bg-white p-5">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Flowchart</div>
                        <h2 className="text-[22px] font-bold tracking-[-0.03em]">15-Step Checklist</h2>
                      </div>
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

                    <div className="space-y-3">
                      {selectedProject.phases.map((phase) => {
                        const doneCount = phase.steps.filter((step) => step.checked).length;
                        const phaseOverdueCount = getPhaseOverdueCount(phase);

                        return (
                          <div key={phase.id} className="overflow-hidden rounded-[22px] border border-neutral-200">
                            <button
                              onClick={() => togglePhase(selectedProject.id, phase.id)}
                              className="flex w-full items-start justify-between gap-4 border-b border-neutral-200 bg-[#f8f7f5] px-4 py-4 text-left"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-[18px] font-bold tracking-[-0.02em]">{phase.title}</div>
                                  {phaseOverdueCount > 0 && (
                                    <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
                                      {phaseOverdueCount} overdue
                                    </span>
                                  )}
                                </div>

                                <div className="mt-1 text-xs text-neutral-500">
                                  {doneCount}/{phase.steps.length} done
                                </div>

                                {!phase.expanded && (
                                  <div className="mt-2 text-sm leading-6 text-neutral-500">
                                    {phase.steps.map((step) => step.label).join(" · ")}
                                  </div>
                                )}
                              </div>

                              <div className="pt-1 text-xl text-neutral-500">{phase.expanded ? "−" : "+"}</div>
                            </button>

                            {phase.expanded && (
                              <div className="space-y-4 px-4 py-4">
                                {phase.steps.map((step) => {
                                  const overdue = !step.checked && !!step.dueDate && isOverdue(step.dueDate);
                                  const assigneeMember = globalMembers.find((m) => m.id === step.assigneeMemberId);
                                  const commentDraft = commentDrafts[step.id] ?? "";
                                  const mentionQuery = extractMentionQuery(commentDraft);
                                  const mentionCandidates =
                                    mentionQuery !== null
                                      ? globalMembers.filter(
                                          (member) =>
                                            member.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                                            member.email.toLowerCase().includes(mentionQuery.toLowerCase())
                                        )
                                      : [];

                                  return (
                                    <div key={step.id} className="rounded-[20px] border border-neutral-200 bg-white px-4 py-4">
                                      <div className="flex items-start gap-3">
                                        <input
                                          type="checkbox"
                                          checked={step.checked}
                                          onChange={(e) =>
                                            toggleStepChecked(selectedProject.id, phase.id, step.id, e.target.checked)
                                          }
                                          className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                                        />

                                        <div className="min-w-0 flex-1">
                                          <div className="text-[16px] font-medium text-neutral-900">{step.label}</div>

                                          {overdue && (
                                            <div className="mt-2 inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                                              OVERDUE
                                            </div>
                                          )}

                                          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[240px_240px_minmax(0,1fr)_110px]">
                                            <div className="rounded-xl border border-[#c8d5ff] bg-[#f5f8ff] px-3 py-2.5">
                                              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                                Due Date
                                              </div>
                                              <Input
                                                type="datetime-local"
                                                value={step.dueDate}
                                                onChange={(v) =>
                                                  updateStep(selectedProject.id, phase.id, step.id, { dueDate: v })
                                                }
                                              />
                                            </div>

                                            <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
                                              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                                Confirmed At
                                              </div>
                                              <Input
                                                type="datetime-local"
                                                value={step.confirmedAt}
                                                onChange={(v) =>
                                                  updateStep(selectedProject.id, phase.id, step.id, { confirmedAt: v })
                                                }
                                              />
                                            </div>

                                            <div className="rounded-xl border border-[#c8d5ff] bg-[#f5f8ff] px-3 py-2.5">
                                              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                                Remark
                                              </div>
                                              <Input
                                                value={step.memo}
                                                onChange={(v) =>
                                                  updateStep(selectedProject.id, phase.id, step.id, { memo: v })
                                                }
                                                placeholder="마감 메모"
                                              />
                                            </div>

                                            <button
                                              onClick={() =>
                                                updateStep(selectedProject.id, phase.id, step.id, {
                                                  dueDate: "",
                                                  confirmedAt: "",
                                                  memo: "",
                                                  assigneeMemberId: "",
                                                  dueReminderSentAt: "",
                                                })
                                              }
                                              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
                                            >
                                              초기화
                                            </button>
                                          </div>

                                          <div className="mt-3 max-w-full xl:max-w-[320px]">
                                            <div className="rounded-xl border border-[#c8d5ff] bg-[#f5f8ff] px-3 py-2.5">
                                              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                                Assignee
                                              </div>
                                              <select
                                                value={assigneeMember ? step.assigneeMemberId : ""}
                                                onChange={(e) =>
                                                  updateStep(selectedProject.id, phase.id, step.id, {
                                                    assigneeMemberId: e.target.value,
                                                  })
                                                }
                                                className="w-full cursor-pointer bg-transparent text-[14px] text-neutral-900 outline-none"
                                              >
                                                <option value="">미지정</option>
                                                {globalMembers.map((member) => (
                                                  <option key={member.id} value={member.id}>
                                                    {member.name}
                                                  </option>
                                                ))}
                                              </select>
                                              {assigneeMember ? (
                                                <div className="mt-1.5 truncate text-[11px] text-neutral-500">
                                                  {assigneeMember.email}
                                                </div>
                                              ) : null}
                                            </div>
                                          </div>

                                          <div className="mt-4 rounded-2xl border border-neutral-200 bg-[#faf9f7] p-3">
                                            <div className="mb-2 flex items-center justify-between">
                                              <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                                                Comments / Mentions
                                              </div>
                                              <button
                                                onClick={() => toggleCommentOpen(step.id)}
                                                className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium"
                                              >
                                                {commentOpenMap[step.id] ? "Hide" : "Open"}
                                              </button>
                                            </div>

                                            {commentOpenMap[step.id] && (
                                              <div className="relative">
                                                <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                                                  <textarea
                                                    value={commentDraft}
                                                    onChange={(e) => setCommentDraft(step.id, e.target.value)}
                                                    placeholder="@김성경 확인 부탁 / @name 으로 멘션"
                                                    className="min-h-[88px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-neutral-400"
                                                  />
                                                </div>

                                                {mentionQuery !== null && mentionCandidates.length > 0 && (
                                                  <div className="absolute left-0 top-full z-10 mt-2 w-full rounded-2xl border border-neutral-200 bg-white p-2 shadow-lg">
                                                    {mentionCandidates.map((member) => (
                                                      <button
                                                        key={member.id}
                                                        onClick={() => applyMention(step.id, member)}
                                                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-neutral-50"
                                                      >
                                                        <MemberInitial name={member.name} />
                                                        <div className="min-w-0">
                                                          <div className="truncate text-sm font-medium">{member.name}</div>
                                                          <div className="truncate text-xs text-neutral-500">{member.email}</div>
                                                        </div>
                                                      </button>
                                                    ))}
                                                  </div>
                                                )}

                                                <div className="mt-2 flex justify-end">
                                                  <button
                                                    type="button"
                                                    disabled={savingCommentStepId === step.id}
                                                    onClick={() => {
                                                      void addCommentWithMentions(selectedProject.id, phase.id, step.id);
                                                    }}
                                                    className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                  >
                                                    {savingCommentStepId === step.id ? "저장 중…" : "Save Comment"}
                                                  </button>
                                                </div>
                                              </div>
                                            )}

                                            <div className="mt-3 space-y-2">
                                              {step.comments.length === 0 ? (
                                                <div className="text-sm text-neutral-400">아직 댓글이 없습니다.</div>
                                              ) : (
                                                step.comments.map((comment) => (
                                                  <div
                                                    key={comment.id}
                                                    className="rounded-xl border border-neutral-200 bg-white px-3 py-3"
                                                  >
                                                    <div className="flex items-center justify-between gap-3">
                                                      <div className="text-sm font-semibold">{comment.authorName}</div>
                                                      <div className="text-xs text-neutral-400">{comment.createdAt}</div>
                                                    </div>
                                                    <div className="mt-2 text-sm leading-6 text-neutral-700">
                                                      {renderMentions(comment.message, comment.mentions)}
                                                    </div>
                                                  </div>
                                                ))
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>

                <aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
                  <section className="rounded-[26px] border border-neutral-200 bg-white p-4">
                    <div className="mb-3">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.22em] text-neutral-500">Update Log</div>
                      <h2 className="text-[20px] font-bold tracking-[-0.03em]">Email Log</h2>
                    </div>

                    <div className="space-y-3">
                      {selectedProject.notificationLogs.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-neutral-200 bg-[#faf9f7] px-4 py-6 text-center text-sm text-neutral-400">
                          아직 이메일 알림 로그가 없습니다.
                        </div>
                      ) : (
                        selectedProject.notificationLogs.map((log) => (
                          <div key={log.id} className="rounded-2xl border border-neutral-200 bg-[#faf9f7] px-3 py-3">
                            <div className="text-sm font-semibold">{log.stepLabel}</div>
                            <div className="mt-1 text-xs text-neutral-500">{log.phaseTitle}</div>
                            <div className="mt-2 text-xs text-neutral-600">
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
                            <div className="mt-2 text-sm text-neutral-700">{log.commentText}</div>
                            <div className="mt-2 text-xs text-neutral-400">{log.createdAt}</div>
                            {log.emailNotify && (
                              <div className="mt-2 border-t border-neutral-200 pt-2 text-[11px] leading-relaxed text-neutral-600">
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
                                  <div className="mt-1 text-rose-600">{log.emailNotify.overallError}</div>
                                ) : null}
                                {log.emailNotify.perRecipient.some((r) => !r.ok) ? (
                                  <ul className="mt-1 list-inside list-disc text-neutral-500">
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
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <div className="rounded-[26px] border border-neutral-200 bg-white px-6 py-16 text-center">
              <div className="text-[22px] font-bold">프로젝트가 없습니다.</div>
              <div className="mt-2 text-sm text-neutral-500">왼쪽에서 New Project로 시작하면 됩니다.</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}