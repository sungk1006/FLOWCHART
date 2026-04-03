-- 접속/heartbeat용. 기존 (share_id, user_id) partial unique(002) 유지.

alter table public.members
  add column if not exists last_seen_at timestamptz;

comment on column public.members.last_seen_at is
  '마지막 보드 접속/heartbeat 시각 (온라인 판정에 사용)';
