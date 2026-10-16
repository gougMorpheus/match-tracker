-- Rollback zu 20261016_02_web_push.sql. Entfernt Trigger, RPCs, Push-Tabellen (Abos + Dedupe-Protokoll gehen verloren),
-- Vault-Eintraege und das private Schema. games/events bleiben unberuehrt.
-- Danach App auf den Stand vor Stufe (b) zuruecksetzen (alte App ruft die mt_push_*-RPCs nicht auf).
begin;
drop trigger if exists mt_push_after_event_insert on public.events;
drop trigger if exists mt_push_after_game_deleted on public.games;
drop function if exists public.mt_push_subscribe(uuid, text, text, text, boolean, timestamptz, uuid[], uuid[], text);
drop function if exists public.mt_push_set_follows(uuid, boolean, timestamptz, uuid[], uuid[]);
drop function if exists public.mt_push_unsubscribe(uuid, text);
drop function if exists public.mt_push_status(uuid);
drop function if exists public.mt_push_claim(text, uuid, uuid, jsonb);
drop function if exists public.mt_push_targets(text, uuid);
drop function if exists public.mt_push_report(text, uuid, text[], int, int, int, uuid[], uuid[]);
drop table if exists public.push_sent_highlights;
drop table if exists public.push_subscriptions;
delete from vault.secrets where name in ('mt_push_secret', 'mt_push_url');
drop schema if exists mt_private cascade;
commit;
-- Optional (nur wenn nichts anderes pg_net nutzt):
-- drop extension if exists pg_net;
