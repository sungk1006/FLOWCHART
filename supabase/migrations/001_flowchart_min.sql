-- 1차 최소: text PK (클라이언트 createId 문자열 호환). 운영 전 RLS 필수.

create table public.members (
  id text primary key,
  share_id uuid not null,
  name text not null,
  email text not null,
  role text not null check (role in ('관리자', '사용자'))
);

create index members_share_id_idx on public.members (share_id);

create table public.projects (
  id text primary key,
  share_id uuid not null,
  code text not null,
  status text not null check (
    status in ('REVIEW', 'IN PROGRESS', 'HOLD', 'DONE', 'DRAFT')
  ),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index projects_share_id_idx on public.projects (share_id);
create index projects_share_id_updated_at_idx on public.projects (share_id, updated_at desc);
