const ONLINE_WINDOW_MS = 90_000;

/** last_seen_at 기준 최근 90초 이내면 접속중 */
export function isMemberOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt?.trim()) return false;
  const t = new Date(lastSeenAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < ONLINE_WINDOW_MS;
}
