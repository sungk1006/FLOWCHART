/** 전체 스냅샷(레거시). Supabase 미사용 시에만 쓰임 */
export const FLOWCHART_LEGACY_STORAGE_KEY = "flowchart-dashboard-v4";

/** Supabase 사용 시: 선택된 프로젝트 id만 저장 */
export const FLOWCHART_SELECTED_ID_KEY = "flowchart-selected-id-v1";

/** 브라우저에서는 `?shareId=`가 있으면 env보다 우선 (동일 탭에서 여러 보드 테스트용) */
export function getFlowchartShareId(): string | null {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("shareId")?.trim();
    if (q) return q;
  }
  const v = process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim();
  return v || null;
}

/**
 * SSR 시에는 window가 없어 `?shareId=`만으로는 켜지지 않음(하이드레이션 일치).
 * 클라이언트에서는 URL 또는 env 중 하나라도 shareId가 있으면 Supabase 경로 사용.
 */
export function isSupabaseDashboardEnabled(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  /** 로컬 `npm run dev`: shareId 없이도 Supabase 경로 사용(로드/디버그 일관) */
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  if (typeof window === "undefined") {
    return Boolean(process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim());
  }
  return Boolean(getFlowchartShareId());
}
