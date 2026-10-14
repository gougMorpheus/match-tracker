-- Rollback zu 20261014_01_sperre_passwort.sql (VORSCHLAG, NICHT AUSGEFUEHRT).
begin;
drop trigger if exists mt_guard_events on public.events;
drop trigger if exists mt_guard_games on public.games;
drop function if exists public.mt_guard_events();
drop function if exists public.mt_guard_games();
drop function if exists public.mt_is_locked(timestamptz);
drop function if exists public.mt_has_edit_grant(uuid);
drop function if exists public.mt_unlock_game(uuid, text);
drop function if exists public.mt_check_admin_password(text);
drop table if exists public.mt_edit_grants;
drop table if exists public.mt_admin_secret;
notify pgrst, 'reload schema';
commit;
