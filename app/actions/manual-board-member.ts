"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ManualMemberResult =
  | { ok: true; id: string }
  | { ok: false; reason: "no_share" | "no_user" | "db_error"; message?: string };

function createManualMemberId() {
  return `member-manual-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function insertManualBoardMember(input: {
  name: string;
  email: string;
  role: "관리자" | "사용자";
}): Promise<ManualMemberResult> {
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

  const id = createManualMemberId();
  const { error } = await supabase.from("members").insert({
    id,
    share_id: shareId,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    user_id: null,
  });

  if (error) {
    return { ok: false, reason: "db_error", message: error.message };
  }

  return { ok: true, id };
}

export async function deleteManualBoardMember(memberId: string): Promise<{ ok: true } | ManualMemberResult> {
  const shareId = process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim();
  if (!shareId) {
    return { ok: false, reason: "no_share", message: "NEXT_PUBLIC_FLOWCHART_SHARE_ID is not set" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("members")
    .delete()
    .eq("id", memberId)
    .eq("share_id", shareId)
    .is("user_id", null);

  if (error) {
    return { ok: false, reason: "db_error", message: error.message };
  }

  return { ok: true };
}
