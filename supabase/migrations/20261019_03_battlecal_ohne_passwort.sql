-- Battle-Cal: Profile ohne Passwort (wie im Original) + Passwort setzen/aendern. Nur Schema battlecal und public.bc_*.
-- Unveraendert: public.games/events, mt_*-Funktionen, Realtime-Publikation, PostgREST-Einstellungen.
-- 1) battlecal.profiles.password_hash darf NULL sein = "kein Passwort". Der Sperrwert '!' aus dem Import (Profil ohne
--    Passwort im Original) wird zu NULL.
-- 2) require_profile: Profil ohne Passwort -> Schreiben/Umbenennen ohne Passwort (wie im Original).
--    Ausnahme bc_profile_delete: ein Profil ohne Passwort loescht nur das Admin-Passwort (Schutz vor versehentlichem Loeschen).
-- 3) bc_profile_set_password: ohne bisheriges Passwort frei setzbar, sonst nur mit altem Passwort oder Admin-Passwort.
--    Gespeichert nur als bcrypt-Hash (pgcrypto), kein Klartext.
-- 4) Profil-JSON zeigt has_password (true/false), nie den Hash.
-- bc_profile_create bleibt wie bisher (Passwort beim Anlegen Pflicht, wie das Loeschpasswort im Original).
-- Rollback: 20261019_03_battlecal_ohne_passwort.rollback.sql

alter table battlecal.profiles alter column password_hash drop not null;
update battlecal.profiles set password_hash = null where password_hash = '!';

create or replace function battlecal.profile_json(p battlecal.profiles) returns jsonb
language sql stable as $$ select jsonb_build_object('id', p.id, 'name', p.name, 'created_at', p.created_at, 'updated_at', p.updated_at,
  'has_password', p.password_hash is not null) $$;
revoke all on function battlecal.profile_json(battlecal.profiles) from public, anon, authenticated;

create or replace function battlecal.require_profile(p_id uuid, p_password text, p_allow_admin boolean default false)
returns battlecal.profiles
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare p battlecal.profiles;
begin
  select * into p from battlecal.profiles where id = p_id and deleted_at is null;
  if not found then perform battlecal.fail('not_found', 'Profil nicht gefunden.'); end if;
  if p.password_hash is null then return p; end if;  -- Profil ohne Passwort (wie im Original)
  if coalesce(p_password, '') <> '' and extensions.crypt(p_password, p.password_hash) = p.password_hash then return p; end if;
  if p_allow_admin and battlecal.admin_ok(p_password) then return p; end if;
  perform battlecal.fail('forbidden', 'Passwort ist falsch.');
  return p;
end $$;
revoke all on function battlecal.require_profile(uuid, text, boolean) from public, anon, authenticated;

-- Weich loeschen: Profil + Historie + profilabhaengige Armeen (Profil-Passwort oder Admin-Passwort;
-- Profil ohne Passwort nur mit Admin-Passwort).
create or replace function public.bc_profile_delete(p_profile_id uuid, p_password text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare t timestamptz := now(); p battlecal.profiles;
begin
  p := battlecal.require_profile(p_profile_id, p_password, true);
  if p.password_hash is null and not battlecal.admin_ok(p_password) then
    perform battlecal.fail('forbidden', 'Profil ohne Passwort: Löschen nur mit Admin-Passwort.');
  end if;
  update battlecal.army_weapons set deleted_at = t where deleted_at is null and roster_id in (select id from battlecal.army_rosters where profile_id = p_profile_id);
  update battlecal.army_units set deleted_at = t where deleted_at is null and roster_id in (select id from battlecal.army_rosters where profile_id = p_profile_id);
  update battlecal.army_rosters set deleted_at = t where deleted_at is null and profile_id = p_profile_id;
  update battlecal.results set deleted_at = t where deleted_at is null and profile_id = p_profile_id;
  update battlecal.profiles set deleted_at = t, updated_at = t where id = p_profile_id;
  return jsonb_build_object('ok', true, 'deleted_at', t);
end $$;

create or replace function public.bc_profile_set_password(p_profile_id uuid, p_password text, p_new_password text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare p battlecal.profiles;
begin
  if coalesce(p_new_password, '') = '' then perform battlecal.fail('invalid', 'Neues Passwort fehlt.'); end if;
  if length(p_new_password) > 200 then perform battlecal.fail('invalid', 'Passwort ist zu lang.'); end if;
  select * into p from battlecal.profiles where id = p_profile_id and deleted_at is null for update;
  if not found then perform battlecal.fail('not_found', 'Profil nicht gefunden.'); end if;
  if p.password_hash is not null
     and not (coalesce(p_password, '') <> '' and extensions.crypt(p_password, p.password_hash) = p.password_hash)
     and not battlecal.admin_ok(p_password) then
    perform battlecal.fail('forbidden', 'Passwort ist falsch.');
  end if;
  update battlecal.profiles set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_profile_id returning * into p;
  return battlecal.profile_json(p);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('bc_profile_delete', 'bc_profile_set_password') loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
