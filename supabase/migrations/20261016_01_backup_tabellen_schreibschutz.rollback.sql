-- Rollback zu 20261016_01_backup_tabellen_schreibschutz.sql: vorherige Rechte wiederherstellen.
begin;
grant insert, update, delete, truncate on table public.events_backup_before_timer_corrections to anon, authenticated;
grant insert, update, delete, truncate on table public.games_backup_before_timer_corrections to anon, authenticated;
commit;
