-- Link board members to Supabase Auth. Legacy/manual rows keep user_id null.

alter table public.members
  add column if not exists user_id uuid references auth.users (id) on delete set null;

comment on column public.members.user_id is
  'auth.users.id when this row represents a logged-in user; null = manual/legacy';

create unique index if not exists members_share_id_user_id_uidx
  on public.members (share_id, user_id)
  where user_id is not null;
