"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type EnsureBoardMemberResult =
  | { ok: true; created: boolean; linked?: boolean }
  | { ok: false; reason: "no_user" | "db_error"; message?: string };

/**
 * 현재 세션 사용자가 해당 share 보드에 members 행이 없으면 생성합니다.
 * 보드는 `NEXT_PUBLIC_FLOWCHART_SHARE_ID`와 동일한 share_id만 사용합니다.
 * 이미 (share_id, user_id) 조합이 있으면 아무 것도 하지 않습니다.
 * 같은 이메일의 수동 멤버가 있으면 해당 row에 user_id를 연결합니다.
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

  // 1) 이미 user_id로 연결된 멤버가 있는지 확인
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
    return { ok: true, created: false };
  }

  // 2) 같은 이메일의 수동 멤버가 있는지 확인
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
        })
        .eq("id", manual.id);

      if (updErr) {
        return { ok: false, reason: "db_error", message: updErr.message };
      }

      return { ok: true, created: false, linked: true };
    }
  }

  // 3) 없으면 새 멤버 생성
  const id = `member-auth-${uid}`;

  const { error: insErr } = await supabase.from("members").insert({
    id,
    share_id: shareId,
    name: displayName,
    email,
    role: "사용자",
    user_id: uid,
  });

  if (insErr) {
    return { ok: false, reason: "db_error", message: insErr.message };
  }

  return { ok: true, created: true };
}