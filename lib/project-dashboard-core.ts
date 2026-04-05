export type ProjectStatus = "REVIEW" | "IN PROGRESS" | "HOLD" | "DONE" | "DRAFT";

/** 플로우차트/동기화 없이 필터·그룹·옵션 계산에 쓰는 최소 형태 */
export type ProjectLike = {
  id: string;
  code: string;
  item: string | null;
  country: string | null;
  certificate: string | null;
  businessModel: string | null;
  incoterms: string | null;
  exporter: string | null;
  client: string | null;
  /** 필터 미사용 — 옵션 병합·관리용 */
  hsCode: string | null;
  status: ProjectStatus;
};

export type SelectOptions = {
  items: string[];
  countries: string[];
  certificates: string[];
  businessModels: string[];
  incoterms: string[];
  exporters: string[];
  clients: string[];
  hsCodes: string[];
};

export type ProjectFilters = {
  item: string[];
  country: string[];
  businessModel: string[];
  incoterms: string[];
  exporter: string[];
  client: string[];
  status: ProjectStatus[];
};

export type SelectOptionFieldKey = keyof SelectOptions;

const FIELD_TO_PROJECT_GETTER: Record<
  SelectOptionFieldKey,
  (p: ProjectLike) => string | null
> = {
  items: (p) => p.item,
  countries: (p) => p.country,
  certificates: (p) => p.certificate,
  businessModels: (p) => p.businessModel,
  incoterms: (p) => p.incoterms,
  exporters: (p) => p.exporter,
  clients: (p) => p.client,
  hsCodes: (p) => p.hsCode,
};

export const DEFAULT_ITEM_SEEDS = [
  "GREEN BEAN",
  "INSTANT COFFEE",
  "DECAF GREEN",
  "TEA EXTRACT",
  "TEMPLATE",
  "OTHER",
];

export function emptySelectOptions(): SelectOptions {
  return {
    items: [...DEFAULT_ITEM_SEEDS],
    countries: [],
    certificates: [],
    businessModels: [],
    incoterms: [],
    exporters: [],
    clients: [],
    hsCodes: [],
  };
}

export function defaultProjectFilters(): ProjectFilters {
  return {
    item: [],
    country: [],
    businessModel: [],
    incoterms: [],
    exporter: [],
    client: [],
    status: [],
  };
}

export function normalizeOptionToken(raw: string): string {
  return raw.trim();
}

/** 대소문자 무시 중복 검사용 */
export function findOptionCaseInsensitive(list: string[], candidate: string): string | undefined {
  const t = candidate.trim().toLowerCase();
  return list.find((o) => o.trim().toLowerCase() === t);
}

export function addOptionToList(list: string[], raw: string): { next: string[]; canonical: string } | null {
  const trimmed = normalizeOptionToken(raw);
  if (!trimmed) return null;
  const existing = findOptionCaseInsensitive(list, trimmed);
  if (existing !== undefined) return { next: list, canonical: existing };
  return { next: [...list, trimmed], canonical: trimmed };
}

export function removeOptionFromList(list: string[], raw: string): string[] {
  const t = raw.trim().toLowerCase();
  return list.filter((o) => o.trim().toLowerCase() !== t);
}

export function countOptionUsage(
  field: SelectOptionFieldKey,
  value: string,
  projects: ProjectLike[]
): number {
  const get = FIELD_TO_PROJECT_GETTER[field];
  const target = value.trim().toLowerCase();
  if (!target) return 0;
  return projects.filter((p) => {
    const v = get(p);
    if (v == null || !String(v).trim()) return false;
    return String(v).trim().toLowerCase() === target;
  }).length;
}

export function isOptionUsed(field: SelectOptionFieldKey, value: string, projects: ProjectLike[]): boolean {
  return countOptionUsage(field, value, projects) > 0;
}

export function mergeSelectOptionsWithProjects(
  base: SelectOptions,
  projects: ProjectLike[]
): SelectOptions {
  const out: SelectOptions = {
    items: [...base.items],
    countries: [...base.countries],
    certificates: [...base.certificates],
    businessModels: [...base.businessModels],
    incoterms: [...base.incoterms],
    exporters: [...base.exporters],
    clients: [...base.clients],
    hsCodes: [...base.hsCodes],
  };

  const add = (key: SelectOptionFieldKey, val: string | null) => {
    if (val == null || !String(val).trim()) return;
    const s = String(val).trim();
    const cur = out[key];
    if (findOptionCaseInsensitive(cur, s) === undefined) {
      out[key] = [...cur, s];
    }
  };

  for (const p of projects) {
    add("items", p.item);
    add("countries", p.country);
    add("certificates", p.certificate);
    add("businessModels", p.businessModel);
    add("incoterms", p.incoterms);
    add("exporters", p.exporter);
    add("clients", p.client);
    add("hsCodes", p.hsCode);
  }

  return out;
}

function matchesMultiString(selected: string[], actual: string | null): boolean {
  if (!selected.length) return true;
  const a = actual == null ? "" : String(actual).trim();
  if (!a) return false;
  const al = a.toLowerCase();
  return selected.some((s) => s.trim().toLowerCase() === al);
}

function matchesMultiStatus(selected: ProjectStatus[], actual: ProjectStatus): boolean {
  if (!selected.length) return true;
  return selected.includes(actual);
}

export function applyProjectFilters<T extends ProjectLike>(projects: T[], filters: ProjectFilters): T[] {
  return projects.filter((p) => {
    if (!matchesMultiString(filters.item, p.item)) return false;
    if (!matchesMultiString(filters.country, p.country)) return false;
    if (!matchesMultiString(filters.businessModel, p.businessModel)) return false;
    if (!matchesMultiString(filters.incoterms, p.incoterms)) return false;
    if (!matchesMultiString(filters.exporter, p.exporter)) return false;
    if (!matchesMultiString(filters.client, p.client)) return false;
    if (!matchesMultiStatus(filters.status, p.status)) return false;
    return true;
  });
}

const NO_ITEM_KEY = "__no_item__";

export function groupProjectsByItem<T extends ProjectLike>(projects: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const p of projects) {
    const raw = p.item == null ? "" : String(p.item).trim();
    const key = raw || NO_ITEM_KEY;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" }));
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" })));
}

export function displayItemGroupLabel(key: string): string {
  return key === NO_ITEM_KEY ? "(No item)" : key;
}
