-- Rollback zu 20261019_03_battlecal_ohne_passwort.sql (Migrationen 01/02 bleiben bestehen).
-- Profile ohne Passwort bekommen wieder den Sperrwert '!' (Zustand nach dem Import). Ein inzwischen gesetztes
-- Passwort (bcrypt-Hash) bleibt erhalten. Definitionen unten = Stand Migration 01.
begin;
drop function if exists public.bc_profile_set_password(uuid, text, text);
update battlecal.profiles set password_hash = '!' where password_hash is null;
alter table battlecal.profiles alter column password_hash set not null;
create or replace function battlecal.profile_json(p battlecal.profiles) returns jsonb
language sql stable as $$ select jsonb_build_object('id', p.id, 'name', p.name, 'created_at', p.created_at, 'updated_at', p.updated_at) $$;
revoke all on function battlecal.profile_json(battlecal.profiles) from public, anon, authenticated;
create or replace function battlecal.require_profile(p_id uuid, p_password text, p_allow_admin boolean default false)
returns battlecal.profiles
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare p battlecal.profiles;
begin
  select * into p from battlecal.profiles where id = p_id and deleted_at is null;
  if not found then perform battlecal.fail('not_found', 'Profil nicht gefunden.'); end if;
  if coalesce(p_password, '') <> '' and extensions.crypt(p_password, p.password_hash) = p.password_hash then return p; end if;
  if p_allow_admin and battlecal.admin_ok(p_password) then return p; end if;
  perform battlecal.fail('forbidden', 'Passwort ist falsch.');
  return p;
end $$;
revoke all on function battlecal.require_profile(uuid, text, boolean) from public, anon, authenticated;
create or replace function public.bc_profile_delete(p_profile_id uuid, p_password text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare t timestamptz := now();
begin
  perform battlecal.require_profile(p_profile_id, p_password, true);
  update battlecal.army_weapons set deleted_at = t where deleted_at is null and roster_id in (select id from battlecal.army_rosters where profile_id = p_profile_id);
  update battlecal.army_units set deleted_at = t where deleted_at is null and roster_id in (select id from battlecal.army_rosters where profile_id = p_profile_id);
  update battlecal.army_rosters set deleted_at = t where deleted_at is null and profile_id = p_profile_id;
  update battlecal.results set deleted_at = t where deleted_at is null and profile_id = p_profile_id;
  update battlecal.profiles set deleted_at = t, updated_at = t where id = p_profile_id;
  return jsonb_build_object('ok', true, 'deleted_at', t);
end $$;
revoke all on function public.bc_profile_delete(uuid, text) from public;
grant execute on function public.bc_profile_delete(uuid, text) to anon, authenticated;
commit;
