-- Rollback Phase 1. Reihenfolge: Phase-2-Rollback -> App-Rollback -> dieses Skript.
-- Zurueckgenommene Ereignisse werden wie frueher (Undo = Loeschen) physisch entfernt,
-- Audit-Zeilen (revoke/restore) ebenfalls; danach Spalten/Funktionen/Index entfernen.
begin;
delete from public.events where revoked_by is not null;
delete from public.events where event_type in ('revoke', 'restore');
drop policy if exists "events_select_all" on public.events;
create policy "events_select_all" on public.events for select using (true);
drop index if exists public.events_flow_unique;
drop index if exists public.idx_events_revoked_by;
drop function if exists public.mt_revoke_event(uuid, uuid, bigint);
drop function if exists public.mt_put_event(jsonb, bigint, bigint);
drop function if exists public.mt_delete_game(uuid, text);
drop function if exists public.mt_save_game(jsonb, bigint);
drop function if exists public.mt_schema_info();
drop function if exists public.mt_conflict(text, uuid, bigint, bigint);
drop function if exists public.mt_is_flow_event(text);
alter table public.events drop column if exists legacy;
alter table public.events drop column if exists revoked_by;
alter table public.games drop column if exists flow_version;
alter table public.games drop column if exists version;
notify pgrst, 'reload schema';
commit;
