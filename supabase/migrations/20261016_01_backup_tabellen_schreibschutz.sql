-- 2026-10-16: Schreibrechte von anon/authenticated auf die Alt-Backup-Tabellen schliessen.
-- Ausgangslage (Backup /home/box/ops/backup/match-tracker-2026-10-16-vor-rechte/):
--   events_backup_before_timer_corrections, games_backup_before_timer_corrections:
--   anon und authenticated hatten arwdDxtm (u. a. INSERT/UPDATE/DELETE/TRUNCATE), RLS an, keine Policies.
-- Weder App noch RPCs (mt_*) noch der Keepalive (nur GET games/events) nutzen diese Tabellen.
-- Angewendet am 16.10.2026 06:44 (Berlin) ueber die Management-API.
-- Daten bleiben unveraendert. Lesen (SELECT) bleibt unveraendert; ohne Policy liefert RLS ohnehin keine Zeilen.
begin;
revoke insert, update, delete, truncate on table public.events_backup_before_timer_corrections from anon, authenticated;
revoke insert, update, delete, truncate on table public.games_backup_before_timer_corrections from anon, authenticated;
commit;
