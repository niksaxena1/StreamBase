-- Share saved filter presets across all authenticated users (internal team app).
-- Replaces per-user RLS with team-wide read/write for logged-in users.

drop policy if exists "Users can manage their own saved filters" on saved_filters;

create policy "Authenticated users can read all saved filters"
  on saved_filters
  for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert saved filters"
  on saved_filters
  for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update saved filters"
  on saved_filters
  for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "Authenticated users can delete saved filters"
  on saved_filters
  for delete
  using (auth.uid() is not null);
