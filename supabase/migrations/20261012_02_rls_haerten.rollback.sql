-- Rollback Phase 2: alte offene Schreib-Policies und Grants wiederherstellen (Stand vor 12.10.2026).
begin;
grant insert, update, delete, truncate on public.games, public.events to anon, authenticated;
drop policy if exists "games_insert_all" on public.games;
drop policy if exists "games_update_all" on public.games;
drop policy if exists "games_delete_all" on public.games;
drop policy if exists "events_insert_all" on public.events;
drop policy if exists "events_update_all" on public.events;
drop policy if exists "events_delete_all" on public.events;
create policy "games_insert_all" on public.games for insert with check (true);
create policy "games_update_all" on public.games for update using (true) with check (true);
create policy "games_delete_all" on public.games for delete using (true);
create policy "events_insert_all" on public.events for insert with check (true);
create policy "events_update_all" on public.events for update using (true) with check (true);
create policy "events_delete_all" on public.events for delete using (true);
notify pgrst, 'reload schema';
commit;
