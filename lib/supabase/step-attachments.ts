import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export const FLOWCHART_STEP_FILES_BUCKET = "flowchart-step-files";

/** 업로드 한도 (바이트) */
export const STEP_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

const DISALLOWED_EXT = new Set([
  "exe",
  "bat",
  "cmd",
  "msi",
  "scr",
  "com",
  "dll",
  "sh",
  "ps1",
]);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 위험 확장자 차단. 그 외 일반 문서/이미지/압축 등 허용 */
export function isAttachmentExtensionAllowed(fileName: string): boolean {
  const ext = extensionOf(fileName);
  if (!ext) return true;
  return !DISALLOWED_EXT.has(ext);
}

/** storage object key용 — 경로 구분자 제거 및 길이 제한 */
export function toSafeStorageFileSegment(name: string): string {
  const base = name
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return base || "file";
}

export function buildStepAttachmentStoragePath(
  shareId: string,
  projectId: string,
  stepId: string,
  originalFileName: string
): string {
  const safe = toSafeStorageFileSegment(originalFileName);
  const ts = Date.now();
  return `${shareId.trim()}/${projectId.trim()}/${stepId.trim()}/${ts}_${safe}`;
}

export type UploadStepAttachmentParams = {
  shareId: string;
  projectId: string;
  stepId: string;
  file: File;
};

export type UploadStepAttachmentResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export async function uploadStepAttachmentToStorage(
  params: UploadStepAttachmentParams
): Promise<UploadStepAttachmentResult> {
  const { shareId, projectId, stepId, file } = params;
  if (!shareId?.trim() || !projectId?.trim() || !stepId?.trim()) {
    return { ok: false, error: "share / project / step 정보가 없습니다." };
  }
  if (file.size > STEP_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: `파일은 ${STEP_ATTACHMENT_MAX_BYTES / 1024 / 1024}MB 이하여야 합니다.` };
  }
  if (!isAttachmentExtensionAllowed(file.name)) {
    return { ok: false, error: "허용되지 않는 파일 형식입니다." };
  }

  const path = buildStepAttachmentStoragePath(shareId, projectId, stepId, file.name);
  const sb = getSupabaseBrowserClient();
  const { error } = await sb.storage.from(FLOWCHART_STEP_FILES_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) {
    return { ok: false, error: error.message || "업로드에 실패했습니다." };
  }
  return { ok: true, path };
}

export async function removeStepAttachmentFromStorage(path: string): Promise<{ ok: boolean; error?: string }> {
  if (!path?.trim()) return { ok: false, error: "path가 없습니다." };
  const sb = getSupabaseBrowserClient();
  const { error } = await sb.storage.from(FLOWCHART_STEP_FILES_BUCKET).remove([path]);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Private bucket: 브라우저에서 열기용 signed URL */
export async function getStepAttachmentSignedUrl(
  path: string,
  expiresInSec = 3600
): Promise<{ url: string | null; error?: string }> {
  if (!path?.trim()) return { url: null, error: "path가 없습니다." };
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb.storage
    .from(FLOWCHART_STEP_FILES_BUCKET)
    .createSignedUrl(path.trim(), expiresInSec);
  if (error || !data?.signedUrl) {
    return { url: null, error: error?.message ?? "signed URL 생성 실패" };
  }
  return { url: data.signedUrl };
}
