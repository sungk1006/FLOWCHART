"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isBoardAdminEmail } from "@/lib/board-admin";

export type DeleteBoardMemberResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_share" | "no_user" | "forbidden" | "not_found" | "db_error";
      message?: string;
    };

async function currentUserIsBoardAdmin(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  shareId: string,
  userId: string,
  userEmail: string
): Promise<boolean> {
  if (isBoardAdminEmail(userEmail)) return true;
  const { data: row } = await supabase
    .from("members")
    .select("role")
    .eq("share_id", shareId)
    .eq("user_id", userId)
    .maybeSingle();
  return row?.role === "관리자";
}

/** 관리자만 멤버 삭제 가능. 본인 행은 삭제 불가. */
export async function deleteBoardMemberAsAdmin(memberId: string): Promise<DeleteBoardMemberResult> {
  const shareId = process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim();
  if (!shareId) {
    return { ok: false, reason: "no_share", message: "NEXT_PUBLIC_FLOWCHART_SHARE_ID is not set" };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return { ok: false, reason: "no_user", message: userErr?.message };
  }

  const admin = await currentUserIsBoardAdmin(supabase, shareId, user.id, user.email ?? "");
  if (!admin) {
    return { ok: false, reason: "forbidden", message: "관리자만 멤버를 삭제할 수 있습니다." };
  }

  const { data: target, error: selErr } = await supabase
    .from("members")
    .select("id, user_id")
    .eq("id", memberId)
    .eq("share_id", shareId)
    .maybeSingle();

  if (selErr) {
    return { ok: false, reason: "db_error", message: selErr.message };
  }
  if (!target) {
    return { ok: false, reason: "not_found", message: "멤버를 찾을 수 없습니다." };
  }

  if (target.user_id === user.id) {
    return { ok: false, reason: "forbidden", message: "본인 계정은 삭제할 수 없습니다." };
  }

  const { error: delErr } = await supabase.from("members").delete().eq("id", memberId).eq("share_id", shareId);

  if (delErr) {
    return { ok: false, reason: "db_error", message: delErr.message };
  }

  return { ok: true };
}
