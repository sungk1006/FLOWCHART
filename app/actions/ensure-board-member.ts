"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { roleForBoardMemberEmail } from "@/lib/board-admin";

export type EnsureBoardMemberResult =
  | { ok: true; created: boolean; linked?: boolean; updated?: boolean }
  | { ok: false; reason: "no_user" | "db_error"; message?: string };

/**
 * 현재 세션 사용자를 해당 share 보드 members에 반영합니다.
 * - (share_id, user_id)가 이미 있으면 name/email/role(관리자 이메일)/last_seen_at 갱신
 * - 같은 이메일의 수동 멤버(user_id null)가 있으면 연결 후 갱신
 * - 없으면 새 행 생성 (sungkyung@elcafetal.co.kr → role 관리자)
 */
export async function ensureBoardMemberForCurrentUser(): Promise<EnsureBoardMemberResult> {
  const shareId = process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim();
  if (!shareId) {
    return {
      ok: false,
      reason: "db_error",
      message: "NEXT_PUBLIC_FLOWCHART_SHARE_ID is not set",
    };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return { ok: false, reason: "no_user", message: userErr?.message };
  }

  const uid = user.id;
  const email = user.email ?? "";
  const meta = user.user_metadata as Record<string, unknown> | undefined;

  const fullName =
    typeof meta?.full_name === "string"
      ? meta.full_name
      : typeof meta?.name === "string"
        ? meta.name
        : "";

  const displayName =
    fullName.trim() ||
    (email.includes("@") ? email.split("@")[0]! : email) ||
    "Member";

  const nowIso = new Date().toISOString();
  const role = roleForBoardMemberEmail(email);

  const { data: existing, error: selErr } = await supabase
    .from("members")
    .select("id")
    .eq("share_id", shareId)
    .eq("user_id", uid)
    .maybeSingle();

  if (selErr) {
    return { ok: false, reason: "db_error", message: selErr.message };
  }

  if (existing) {
    const { error: updErr } = await supabase
      .from("members")
      .update({
        name: displayName,
        email,
        role,
        last_seen_at: nowIso,
      })
      .eq("id", existing.id);

    if (updErr) {
      return { ok: false, reason: "db_error", message: updErr.message };
    }

    return { ok: true, created: false, updated: true };
  }

  if (email) {
    const { data: manual, error: manualErr } = await supabase
      .from("members")
      .select("id")
      .eq("share_id", shareId)
      .eq("email", email)
      .is("user_id", null)
      .maybeSingle();

    if (manualErr) {
      return { ok: false, reason: "db_error", message: manualErr.message };
    }

    if (manual) {
      const { error: updErr } = await supabase
        .from("members")
        .update({
          user_id: uid,
          name: displayName,
          email,
          role,
          last_seen_at: nowIso,
        })
        .eq("id", manual.id);

      if (updErr) {
        return { ok: false, reason: "db_error", message: updErr.message };
      }

      return { ok: true, created: false, linked: true };
    }
  }

  const id = `member-auth-${uid}`;

  const { error: insErr } = await supabase.from("members").insert({
    id,
    share_id: shareId,
    name: displayName,
    email,
    role,
    user_id: uid,
    last_seen_at: nowIso,
  });

  if (insErr) {
    const code = (insErr as { code?: string }).code;
    const msg = insErr.message ?? "";
    if (code === "23505" || msg.toLowerCase().includes("duplicate") || msg.includes("unique")) {
      return { ok: true, created: false };
    }
    return { ok: false, reason: "db_error", message: insErr.message };
  }

  return { ok: true, created: true };
}
