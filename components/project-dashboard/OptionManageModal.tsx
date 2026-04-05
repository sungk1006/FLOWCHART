"use client";

import { useEffect, useState } from "react";

import type { ProjectLike, SelectOptionFieldKey, SelectOptions } from "@/lib/project-dashboard-core";
import { countOptionUsage, findOptionCaseInsensitive, normalizeOptionToken } from "@/lib/project-dashboard-core";

type Props = {
  open: boolean;
  field: SelectOptionFieldKey | null;
  title: string;
  options: SelectOptions;
  projects: ProjectLike[];
  onClose: () => void;
  onRemoveOption: (field: SelectOptionFieldKey, value: string) => void;
  onAddOption: (field: SelectOptionFieldKey, rawValue: string) => void;
};

export function OptionManageModal({
  open,
  field,
  title,
  options,
  projects,
  onClose,
  onRemoveOption,
  onAddOption,
}: Props) {
  const [addDraft, setAddDraft] = useState("");

  useEffect(() => {
    if (open) setAddDraft("");
  }, [open, field]);

  if (!open || !field) return null;

  const fieldKey = field;
  const list = options[fieldKey];

  function tryAdd() {
    const t = normalizeOptionToken(addDraft);
    if (!t) return;
    if (findOptionCaseInsensitive(list, t) !== undefined) return;
    onAddOption(fieldKey, t);
    setAddDraft("");
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <div className="text-sm font-semibold">{title} — 옵션 관리</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium"
          >
            닫기
          </button>
        </div>
        <div className="border-b border-neutral-200 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">새 옵션</div>
          <div className="mt-2 flex gap-2">
            <input
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  tryAdd();
                }
              }}
              placeholder="값 입력 후 Enter 또는 추가"
              className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={tryAdd}
              className="shrink-0 rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white"
            >
              추가
            </button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {list.length === 0 ? (
            <div className="py-6 text-center text-sm text-neutral-400">등록된 옵션이 없습니다.</div>
          ) : (
            <ul className="space-y-2">
              {list.map((opt) => {
                const used = countOptionUsage(fieldKey, opt, projects);
                const canDelete = used === 0;
                return (
                  <li
                    key={opt}
                    className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-[#f8f7f5] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{opt}</div>
                      <div className="text-xs text-neutral-500">
                        {used === 0 ? "미사용 — 삭제 가능" : `used in ${used} projects — 삭제 불가`}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canDelete}
                      onClick={() => canDelete && onRemoveOption(fieldKey, opt)}
                      className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
