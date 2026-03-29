import { NextResponse } from "next/server";

import { ensureBoardMemberForCurrentUser } from "@/app/actions/ensure-board-member";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextPath = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback]", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
    const ensured = await ensureBoardMemberForCurrentUser();
    if (!ensured.ok) {
      console.error("[auth/callback] ensureBoardMemberForCurrentUser", ensured);
    }
  }

  return NextResponse.redirect(`${origin}${nextPath.startsWith("/") ? nextPath : `/${nextPath}`}`);
}
