-- Sync-Absicherung Phase 2: kein direktes Schreiben mehr mit dem oeffentlichen Schluessel.
-- Erst ausfuehren, wenn die neue App (RPC-Schreibweg) live ist.
-- Rollback: 20261012_02_rls_haerten.rollback.sql (VOR dem App-Rollback ausfuehren).
begin;
drop policy if exists "games_insert_all" on public.games;
drop policy if exists "games_update_all" on public.games;
drop policy if exists "games_delete_all" on public.games;
drop policy if exists "events_insert_all" on public.events;
drop policy if exists "events_update_all" on public.events;
drop policy if exists "events_delete_all" on public.events;
revoke insert, update, delete, truncate on public.games, public.events from anon, authenticated;
notify pgrst, 'reload schema';
commit;
