import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** DB 컬럼 id는 createId 문자열도 허용하도록 text PK 전제 */
export type ProjectRow = {
  id: string;
  share_id: string;
  code: string;
  status: string;
  updated_at: string;
  payload: Record<string, unknown>;
};

export type MemberRow = {
  id: string;
  share_id: string;
  name: string;
  email: string;
  role: string;
  user_id: string | null;
};

/** page.tsx Project와 구조 호환 — sync 경계에서만 사용 */
export type ProjectSyncInput = {
  id: string;
  code: string;
  status: string;
  country: string;
  exporter: string;
  item: string;
  client: string;
  note: string;
  updated: boolean;
  lastChangedAt: string;
  phases: unknown;
  notificationLogs: unknown;
};

export type MemberSyncInput = {
  id: string;
  name: string;
  email: string;
  role: string;
  /** 연결된 Auth 사용자; 없으면 수동/레거시 멤버 */
  userId?: string | null;
};

export function projectToRow(shareId: string, p: ProjectSyncInput): Omit<ProjectRow, "updated_at"> & { updated_at: string } {
  const { id, code, status, ...payload } = p;
  return {
    id,
    share_id: shareId,
    code,
    status,
    updated_at: new Date().toISOString(),
    payload: payload as Record<string, unknown>,
  };
}

export function rowToProject(row: ProjectRow): Record<string, unknown> {
  const pl =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? { ...row.payload }
      : {};
  return {
    ...pl,
    id: row.id,
    code: row.code,
    status: row.status,
  };
}

export function memberToRow(shareId: string, m: MemberSyncInput): MemberRow {
  return {
    id: m.id,
    share_id: shareId,
    name: m.name,
    email: m.email,
    role: m.role,
    user_id: m.userId ?? null,
  };
}

/** PostgREST/클라이언트에 따라 uuid 컬럼 타입이 달라질 수 있어 문자열만 신뢰 */
export function parseMemberUserIdColumn(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

export function rowToMember(row: MemberRow): MemberSyncInput {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    userId: parseMemberUserIdColumn(row.user_id),
  };
}

export async function loadDashboard(shareId: string): Promise<{
  projects: ProjectRow[];
  members: MemberRow[];
}> {
  const sb = getSupabaseBrowserClient();

  const [pmRes, mbRes] = await Promise.all([
    sb.from("projects").select("*").eq("share_id", shareId),
    sb.from("members").select("*").eq("share_id", shareId),
  ]);

  if (pmRes.error) throw pmRes.error;
  if (mbRes.error) throw mbRes.error;

  console.log("[DEBUG] DB members raw", mbRes.data);

  const rawMembers = (mbRes.data ?? []) as Record<string, unknown>[];
  const members: MemberRow[] = rawMembers.map((r) => ({
    id: String(r.id),
    share_id: String(r.share_id),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    role: String(r.role),
    user_id: parseMemberUserIdColumn(r.user_id),
  }));

  return {
    projects: (pmRes.data ?? []) as ProjectRow[],
    members,
  };
}

export async function upsertProject(shareId: string, p: ProjectSyncInput): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const row = projectToRow(shareId, p);
  const { error } = await sb.from("projects").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function deleteProject(shareId: string, projectId: string): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const { error } = await sb.from("projects").delete().eq("id", projectId).eq("share_id", shareId);
  if (error) throw error;
}

export async function upsertMember(shareId: string, m: MemberSyncInput): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const row = memberToRow(shareId, m);
  const { error } = await sb.from("members").upsert(row as never, { onConflict: "id" });
  if (error) throw error;
}

export async function deleteMember(shareId: string, memberId: string): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const { error } = await sb.from("members").delete().eq("id", memberId).eq("share_id", shareId);
  if (error) throw error;
}

/**
 * share_id 기준 동기화. user_id가 있는 행은 삭제하지 않고(다른 탭/자동 생성 보호),
 * 클라이언트 목록과 upsert로 맞춘다. user_id가 없는 행만 삭제 후 수동 목록을 insert.
 */
export async function replaceMembers(shareId: string, members: MemberSyncInput[]): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const { error: delErr } = await sb.from("members").delete().eq("share_id", shareId).is("user_id", null);
  if (delErr) throw delErr;

  const withAuth = members.filter((m) => m.userId);
  const manualOnly = members.filter((m) => !m.userId);

  for (const m of withAuth) {
    const row = memberToRow(shareId, m);
    const { error } = await sb.from("members").upsert(row as never, { onConflict: "id" });
    if (error) throw error;
  }

  if (manualOnly.length === 0) return;
  const manualRows = manualOnly.map((m) => memberToRow(shareId, m));
  const { error: insErr } = await sb.from("members").insert(manualRows as never[]);
  if (insErr) throw insErr;
}

/** 로컬 state 기준으로 원격 프로젝트 삭제 후 전부 upsert */
export async function syncProjects(shareId: string, projects: ProjectSyncInput[]): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const keepIds = new Set(projects.map((p) => p.id));

  const { data: remote, error: selErr } = await sb.from("projects").select("id").eq("share_id", shareId);
  if (selErr) throw selErr;

  for (const r of remote ?? []) {
    const rid = (r as { id: string }).id;
    if (!keepIds.has(rid)) {
      await deleteProject(shareId, rid);
    }
  }

  for (const p of projects) {
    await upsertProject(shareId, p);
  }
}

export async function syncDashboard(shareId: string, projects: ProjectSyncInput[], members: MemberSyncInput[]): Promise<void> {
  await replaceMembers(shareId, members);
  await syncProjects(shareId, projects);
}
