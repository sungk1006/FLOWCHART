"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ensureBoardMemberForCurrentUser } from "@/app/actions/ensure-board-member";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

async function syncBoardMemberRowAfterAuth() {
  const ensured = await ensureBoardMemberForCurrentUser();
  if (!ensured.ok) {
    console.error("[login] ensureBoardMemberForCurrentUser", ensured);
  }
  return ensured;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState<string | null>(
    urlError === "auth" ? "인증에 실패했습니다. 다시 시도해 주세요." : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sb = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (cancelled) return;
      if (user && !searchParams.get("forceLogout")) {
        router.push("/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const emailTrimmed = email.trim();
    try {
      if (mode === "signup") {
        const localPart = emailTrimmed.includes("@") ? emailTrimmed.split("@")[0]! : emailTrimmed;
        const { error } = await supabase.auth.signUp({
          email: emailTrimmed,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { full_name: localPart || "Member", name: localPart || "Member" },
          },
        });
        if (error) throw error;

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: emailTrimmed,
          password,
        });
        if (signInError) {
          setMessage(
            "가입 확인 메일이 오면 링크를 눌러 주세요. 이메일 확인을 끄면 바로 로그인됩니다."
          );
          router.refresh();
          return;
        }
        await supabase.auth.getSession();
        await syncBoardMemberRowAfterAuth();
        const next = searchParams.get("next") ?? "/";
        router.push(next.startsWith("/") ? next : "/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailTrimmed,
          password,
        });
        if (error) throw error;
        await supabase.auth.getSession();
        await syncBoardMemberRowAfterAuth();
        const next = searchParams.get("next") ?? "/";
        router.push(next.startsWith("/") ? next : "/");
        router.refresh();
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f6f5f3] px-4 text-neutral-900">
      <div className="w-full max-w-[400px] rounded-[28px] border border-neutral-200 bg-white px-8 py-10 shadow-sm">
        <h1 className="text-center text-2xl font-black tracking-tight">FLOWCHART</h1>
        <p className="mt-2 text-center text-sm text-neutral-500">이메일로 로그인 또는 회원가입</p>

        <div className="mt-6 flex rounded-2xl border border-neutral-200 p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold ${
              mode === "login" ? "bg-slate-900 text-white" : "text-neutral-600"
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold ${
              mode === "signup" ? "bg-slate-900 text-white" : "text-neutral-600"
            }`}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              이메일
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-400"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-400"
              placeholder="6자 이상"
            />
          </div>

          {message ? (
            <p className="rounded-xl bg-neutral-100 px-3 py-2 text-center text-sm text-neutral-700">{message}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "처리 중…" : mode === "signup" ? "회원가입" : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f6f5f3] text-sm text-neutral-500">로딩…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
