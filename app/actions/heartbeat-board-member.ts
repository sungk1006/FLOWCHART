"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type HeartbeatResult = { ok: true } | { ok: false; reason: "no_user" | "no_share" | "db_error"; message?: string };

export async function touchBoardMemberHeartbeat(): Promise<HeartbeatResult> {
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

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("members")
    .update({ last_seen_at: now })
    .eq("share_id", shareId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, reason: "db_error", message: error.message };
  }

  return { ok: true };
}
