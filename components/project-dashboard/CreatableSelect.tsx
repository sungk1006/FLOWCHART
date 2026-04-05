"use client";

import { useMemo, useState } from "react";

import { findOptionCaseInsensitive, normalizeOptionToken } from "@/lib/project-dashboard-core";

type Props = {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onCreate: (raw: string) => void;
  onOpenManage: () => void;
  placeholder?: string;
  /** 상세 편집 등: 맨 위에 ALL(빈 값) 옵션 표시. 필터 UI용으로 쓸 때는 false */
  showAllClearOption?: boolean;
};

export function CreatableSelect({
  value,
  options,
  onChange,
  onCreate,
  onOpenManage,
  placeholder,
  showAllClearOption = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.toLowerCase().includes(t));
  }, [options, q]);

  const exact = useMemo(() => {
    const t = normalizeOptionToken(q);
    if (!t) return null;
    return findOptionCaseInsensitive(options, t) ?? null;
  }, [options, q]);

  const canCreate =
    normalizeOptionToken(q).length > 0 && exact === null && findOptionCaseInsensitive(options, q) === undefined;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-lg border border-neutral-200 bg-white py-1 pl-2.5 pr-9 text-left text-[13px] text-neutral-900"
      >
        <span className={value ? "text-neutral-900" : "text-neutral-400"}>
          {value || placeholder || "선택"}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenManage();
        }}
        className="absolute right-1 top-1/2 z-10 h-7 min-w-[1.75rem] -translate-y-1/2 rounded border border-neutral-200 bg-white px-1 text-[11px] font-medium leading-none text-neutral-600 hover:bg-neutral-50"
        title="옵션 관리"
        aria-label="옵션 관리"
      >
        ⋯
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
          <div className="border-b border-neutral-100 px-2 py-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="검색 또는 새 값 입력"
              className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm outline-none"
              autoComplete="off"
            />
          </div>
          {showAllClearOption ? (
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQ("");
              }}
            >
              ALL
            </button>
          ) : null}
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
              onClick={() => {
                onChange(opt);
                setOpen(false);
                setQ("");
              }}
            >
              {opt}
            </button>
          ))}
          {canCreate ? (
            <button
              type="button"
              className="w-full border-t border-neutral-100 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-neutral-50"
              onClick={() => {
                const raw = normalizeOptionToken(q);
                if (!raw) return;
                onCreate(raw);
                setOpen(false);
                setQ("");
              }}
            >
              + 추가: {normalizeOptionToken(q)}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
