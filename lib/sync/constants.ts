/** 전체 스냅샷(레거시). Supabase 미사용 시에만 쓰임 */
export const FLOWCHART_LEGACY_STORAGE_KEY = "flowchart-dashboard-v4";

/** Supabase 사용 시: 선택된 프로젝트 id만 저장 */
export const FLOWCHART_SELECTED_ID_KEY = "flowchart-selected-id-v1";

/** 보드 `share_id`는 `NEXT_PUBLIC_FLOWCHART_SHARE_ID`만 사용 (URL·localStorage 등 미사용) */
export function getFlowchartShareId(): string | null {
  const v = process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim();
  return v || null;
}

/**
 * Supabase 대시보드 경로 사용 여부.
 * production: URL·키·`NEXT_PUBLIC_FLOWCHART_SHARE_ID` 필요.
 * development: URL·키만 있으면 true (shareId 없을 때 로드는 `loadDashboard` 등에서 실패할 수 있음).
 */
export function isSupabaseDashboardEnabled(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  return Boolean(process.env.NEXT_PUBLIC_FLOWCHART_SHARE_ID?.trim());
}
