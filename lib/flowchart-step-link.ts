/**
 * Flowchart 딥링크: ?project=&step=
 * 클라이언트(app/page.tsx)와 API 라우트에서 동일 규칙으로 사용합니다.
 */
export function buildFlowchartStepLink(appBaseUrl: string, projectId: string, stepId: string): string {
  const base = appBaseUrl.trim().replace(/\/+$/, "");
  return `${base}?project=${encodeURIComponent(projectId)}&step=${encodeURIComponent(stepId)}`;
}

/**
 * 메일/API에서 사용할 대시보드 베이스 URL (쿼리·해시 없음).
 * 우선순위: FLOWCHART_APP_URL → NEXT_PUBLIC_APP_URL → request URL의 origin
 */
export function resolveFlowchartAppBaseUrl(request?: Request): string {
  const envFlow = typeof process !== "undefined" ? process.env.FLOWCHART_APP_URL?.trim() : "";
  const envPub = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_APP_URL?.trim() : "";
  const fromEnv = envFlow || envPub;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  if (request) {
    try {
      return new URL(request.url).origin.replace(/\/+$/, "");
    } catch {
      return "";
    }
  }

  return "";
}
