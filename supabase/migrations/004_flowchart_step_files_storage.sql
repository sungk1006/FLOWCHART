-- Private bucket for flowchart step attachments. Authenticated dashboard users only.
-- Apply in Supabase SQL editor or `supabase db push` after review.

insert into storage.buckets (id, name, public)
values ('flowchart-step-files', 'flowchart-step-files', false)
on conflict (id) do nothing;

drop policy if exists "flowchart_step_files_select" on storage.objects;
drop policy if exists "flowchart_step_files_insert" on storage.objects;
drop policy if exists "flowchart_step_files_update" on storage.objects;
drop policy if exists "flowchart_step_files_delete" on storage.objects;

-- Authenticated users: full object access within this bucket (single-board app behind login).
create policy "flowchart_step_files_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'flowchart-step-files');

create policy "flowchart_step_files_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'flowchart-step-files');

create policy "flowchart_step_files_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'flowchart-step-files')
  with check (bucket_id = 'flowchart-step-files');

create policy "flowchart_step_files_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'flowchart-step-files');
