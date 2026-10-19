-- Battle-Cal im Match-Tracker, Stufe B (Basis): eigenes Schema "battlecal" (NICHT per REST freigegeben),
-- leere Tabellen, Zugriff nur ueber public.bc_* (SECURITY DEFINER, Muster wie mt_*).
-- Unveraendert: public.games/events, mt_*-Funktionen, Realtime-Publikation, PostgREST-Einstellungen.
-- Passwoerter: bcrypt per pgcrypto (Schema extensions). Profil-Passwort fuer jedes Schreiben.
-- Admin-Passwort des Match-Trackers ersetzt das alte Battle-Cal-Master-Passwort: geprueft gegen einen bcrypt-Hash
-- im Vault (Name 'bc_admin_password_hash'); der Hash wird NICHT in diesem Repo abgelegt (separater Ops-Schritt).
-- Weich loeschen (deleted_at). Rollback: 20261019_01_battlecal_basis.rollback.sql

create schema if not exists battlecal;
revoke all on schema battlecal from public;
revoke all on schema battlecal from anon, authenticated;

create table if not exists battlecal.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  password_hash text not null,
  mt_player_name text,                         -- optionale spaetere Verknuepfung mit Match-Tracker-Spielern (heute ungenutzt)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists profiles_name_active_uq on battlecal.profiles (lower(name)) where deleted_at is null;

create table if not exists battlecal.results (
  id text primary key check (length(id) between 1 and 120),
  profile_id uuid not null references battlecal.profiles(id),
  created_at timestamptz not null,
  custom_title text not null default '',
  inputs jsonb not null,
  outputs jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists results_profile_created_idx on battlecal.results (profile_id, created_at desc) where deleted_at is null;

create table if not exists battlecal.army_rosters (
  id text primary key check (length(id) between 1 and 120),
  profile_id uuid references battlecal.profiles(id),
  name text not null,
  source_file text not null default '',
  catalogue_name text not null default '',
  game_system_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists army_rosters_profile_name_idx on battlecal.army_rosters (profile_id, name) where deleted_at is null;

create table if not exists battlecal.army_units (
  id text primary key check (length(id) between 1 and 200),
  roster_id text not null references battlecal.army_rosters(id),
  source_file text not null default '',
  name text not null,
  model_count integer not null default 1,
  profile_name text not null default '',
  movement_text text not null default '',
  toughness integer,
  save integer,
  invulnerable_save integer,
  wounds_per_model integer,
  leadership_text text not null default '',
  objective_control integer,
  raw_selection jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists army_units_roster_name_idx on battlecal.army_units (roster_id, name) where deleted_at is null;

create table if not exists battlecal.army_weapons (
  id text primary key check (length(id) between 1 and 200),
  roster_id text not null references battlecal.army_rosters(id),
  unit_id text not null references battlecal.army_units(id),
  model_id text,
  name text not null,
  weapon_type text not null default '',
  weapon_role text not null default 'weapon',
  count integer not null default 1,
  range_text text not null default '',
  attacks_text text not null default '',
  skill_text text not null default '',
  strength_text text not null default '',
  ap_text text not null default '',
  damage_text text not null default '',
  keywords text[] not null default '{}',
  raw_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists army_weapons_unit_name_idx on battlecal.army_weapons (unit_id, name) where deleted_at is null;
create index if not exists army_weapons_model_idx on battlecal.army_weapons (model_id);

-- Zusaetzliche Sicherung: RLS an, KEINE Policies, keine Rechte fuer anon/authenticated.
alter table battlecal.profiles enable row level security;
alter table battlecal.results enable row level security;
alter table battlecal.army_rosters enable row level security;
alter table battlecal.army_units enable row level security;
alter table battlecal.army_weapons enable row level security;
revoke all on all tables in schema battlecal from public, anon, authenticated;
alter default privileges in schema battlecal revoke all on tables from public, anon, authenticated;
alter default privileges in schema battlecal revoke all on functions from public, anon, authenticated;

-- ---------- interne Helfer (Schema battlecal, nicht aufrufbar fuer anon) ----------
create or replace function battlecal.fail(p_code text, p_message text) returns void
language plpgsql set search_path = battlecal, pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = p_message, detail = json_build_object('kind', p_code)::text;
end $$;

create or replace function battlecal.admin_ok(p_password text) returns boolean
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare h text;
begin
  if p_password is null or p_password = '' then return false; end if;
  select decrypted_secret into h from vault.decrypted_secrets where name = 'bc_admin_password_hash' order by created_at desc limit 1;
  return h is not null and extensions.crypt(p_password, h) = h;
end $$;

-- Profil-Passwort pruefen (optional auch Admin-Passwort). Liefert das aktive Profil.
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

create or replace function battlecal.json_size_ok(p jsonb, p_max integer default 262144) returns boolean
language sql immutable as $$ select p is null or octet_length(p::text) <= p_max $$;

create or replace function battlecal.profile_json(p battlecal.profiles) returns jsonb
language sql stable as $$ select jsonb_build_object('id', p.id, 'name', p.name, 'created_at', p.created_at, 'updated_at', p.updated_at) $$;

revoke all on all functions in schema battlecal from public, anon, authenticated;

-- ---------- oeffentliche RPCs ----------
create or replace function public.bc_schema_info() returns jsonb
language sql stable security definer set search_path = battlecal, pg_temp as $$
  select jsonb_build_object('battlecal_schema_version', 1)
$$;

create or replace function public.bc_profiles_list() returns jsonb
language sql stable security definer set search_path = battlecal, pg_temp as $$
  select coalesce(jsonb_agg(battlecal.profile_json(p) order by lower(p.name)), '[]'::jsonb)
  from battlecal.profiles p where p.deleted_at is null
$$;

create or replace function public.bc_profile_create(p_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare p battlecal.profiles;
begin
  if coalesce(btrim(p_name), '') = '' then perform battlecal.fail('invalid', 'Profilname fehlt.'); end if;
  if coalesce(p_password, '') = '' then perform battlecal.fail('invalid', 'Passwort fehlt.'); end if;
  if length(p_password) > 200 then perform battlecal.fail('invalid', 'Passwort ist zu lang.'); end if;
  if exists (select 1 from battlecal.profiles where lower(name) = lower(btrim(p_name)) and deleted_at is null) then
    perform battlecal.fail('conflict', 'Profilname ist schon vergeben.');
  end if;
  insert into battlecal.profiles (name, password_hash) values (btrim(p_name), extensions.crypt(p_password, extensions.gen_salt('bf')))
  returning * into p;
  return battlecal.profile_json(p);
end $$;

create or replace function public.bc_profile_check(p_profile_id uuid, p_password text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare p battlecal.profiles;
begin
  p := battlecal.require_profile(p_profile_id, p_password, false);
  return jsonb_build_object('ok', true, 'profile', battlecal.profile_json(p));
end $$;

create or replace function public.bc_profile_rename(p_profile_id uuid, p_password text, p_name text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare p battlecal.profiles;
begin
  perform battlecal.require_profile(p_profile_id, p_password, true);
  if coalesce(btrim(p_name), '') = '' then perform battlecal.fail('invalid', 'Profilname fehlt.'); end if;
  if exists (select 1 from battlecal.profiles where lower(name) = lower(btrim(p_name)) and deleted_at is null and id <> p_profile_id) then
    perform battlecal.fail('conflict', 'Profilname ist schon vergeben.');
  end if;
  update battlecal.profiles set name = btrim(p_name), updated_at = now() where id = p_profile_id returning * into p;
  return battlecal.profile_json(p);
end $$;

-- Weich loeschen: Profil + Historie + profilabhaengige Armeen (Profil-Passwort oder Admin-Passwort).
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

create or replace function public.bc_results_list(p_profile_id uuid, p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = battlecal, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'custom_title', r.custom_title,
    'inputs', r.inputs, 'outputs', r.outputs) order by r.created_at desc), '[]'::jsonb)
  from (select * from battlecal.results r
        where r.profile_id = p_profile_id and r.deleted_at is null
          and exists (select 1 from battlecal.profiles p where p.id = r.profile_id and p.deleted_at is null)
        order by r.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) r
$$;

create or replace function public.bc_result_upsert(p_profile_id uuid, p_password text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare v_id text := p_result->>'id'; owner uuid;
begin
  perform battlecal.require_profile(p_profile_id, p_password, false);
  if coalesce(v_id, '') = '' or p_result->'inputs' is null or p_result->'outputs' is null then
    perform battlecal.fail('invalid', 'Ergebnis unvollstaendig.');
  end if;
  if not battlecal.json_size_ok(p_result) then perform battlecal.fail('invalid', 'Ergebnis ist zu gross.'); end if;
  select profile_id into owner from battlecal.results where id = v_id;
  if owner is not null and owner <> p_profile_id then perform battlecal.fail('forbidden', 'Ergebnis gehoert zu einem anderen Profil.'); end if;
  insert into battlecal.results (id, profile_id, created_at, custom_title, inputs, outputs)
  values (v_id, p_profile_id, coalesce((p_result->>'created_at')::timestamptz, now()), coalesce(p_result->>'custom_title', ''),
          p_result->'inputs', p_result->'outputs')
  on conflict (id) do update set custom_title = excluded.custom_title, inputs = excluded.inputs, outputs = excluded.outputs,
    created_at = excluded.created_at, updated_at = now(), deleted_at = null;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.bc_result_delete(p_profile_id uuid, p_password text, p_result_id text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare n integer;
begin
  perform battlecal.require_profile(p_profile_id, p_password, false);
  update battlecal.results set deleted_at = now() where id = p_result_id and profile_id = p_profile_id and deleted_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

create or replace function public.bc_results_clear(p_profile_id uuid, p_password text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare n integer;
begin
  perform battlecal.require_profile(p_profile_id, p_password, false);
  update battlecal.results set deleted_at = now() where profile_id = p_profile_id and deleted_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

-- Armeen: lesen frei; Rosters ohne Profil (Seed) nur mit Admin-Passwort schreibbar.
create or replace function public.bc_rosters_list(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = battlecal, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'profile_id', r.profile_id) order by r.name), '[]'::jsonb)
  from battlecal.army_rosters r
  where r.deleted_at is null and r.profile_id is not distinct from p_profile_id
$$;

create or replace function public.bc_roster_get(p_roster_id text, p_include_raw boolean default false) returns jsonb
language sql stable security definer set search_path = battlecal, pg_temp as $$
  select case when r.id is null then null else jsonb_build_object(
    'roster', to_jsonb(r) - 'deleted_at',
    'units', coalesce((select jsonb_agg(case when p_include_raw then to_jsonb(u) - 'deleted_at' else to_jsonb(u) - 'deleted_at' - 'raw_selection' end order by u.name)
                       from battlecal.army_units u where u.roster_id = r.id and u.deleted_at is null), '[]'::jsonb),
    'weapons', coalesce((select jsonb_agg(case when p_include_raw then to_jsonb(w) - 'deleted_at' else to_jsonb(w) - 'deleted_at' - 'raw_profile' end order by w.name)
                         from battlecal.army_weapons w where w.roster_id = r.id and w.deleted_at is null), '[]'::jsonb)) end
  from (select 1) one left join battlecal.army_rosters r on r.id = p_roster_id and r.deleted_at is null
$$;

create or replace function battlecal.require_roster_write(p_profile_id uuid, p_password text, p_roster_id text) returns void
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare owner uuid; found_row boolean;
begin
  select true, profile_id into found_row, owner from battlecal.army_rosters where id = p_roster_id;
  if not coalesce(found_row, false) then perform battlecal.fail('not_found', 'Armee nicht gefunden.'); end if;
  if owner is null then
    if not battlecal.admin_ok(p_password) then perform battlecal.fail('forbidden', 'Nur mit Admin-Passwort.'); end if;
    return;
  end if;
  if owner <> p_profile_id then perform battlecal.fail('forbidden', 'Armee gehoert zu einem anderen Profil.'); end if;
  perform battlecal.require_profile(p_profile_id, p_password, false);
end $$;
revoke all on function battlecal.require_roster_write(uuid, text, text) from public, anon, authenticated;

create or replace function public.bc_roster_upsert(p_profile_id uuid, p_password text, p_roster jsonb) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare v_id text := p_roster->>'id';
begin
  if coalesce(v_id, '') = '' or coalesce(p_roster->>'name', '') = '' then perform battlecal.fail('invalid', 'Armee unvollstaendig.'); end if;
  if exists (select 1 from battlecal.army_rosters where id = v_id) then
    perform battlecal.require_roster_write(p_profile_id, p_password, v_id);
    update battlecal.army_rosters set name = p_roster->>'name', source_file = coalesce(p_roster->>'source_file', source_file),
      catalogue_name = coalesce(p_roster->>'catalogue_name', catalogue_name), game_system_name = coalesce(p_roster->>'game_system_name', game_system_name),
      updated_at = now(), deleted_at = null where id = v_id;
  else
    perform battlecal.require_profile(p_profile_id, p_password, false);
    insert into battlecal.army_rosters (id, profile_id, name, source_file, catalogue_name, game_system_name)
    values (v_id, p_profile_id, p_roster->>'name', coalesce(p_roster->>'source_file', ''), coalesce(p_roster->>'catalogue_name', ''),
            coalesce(p_roster->>'game_system_name', ''));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.bc_roster_delete(p_profile_id uuid, p_password text, p_roster_id text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare t timestamptz := now();
begin
  perform battlecal.require_roster_write(p_profile_id, p_password, p_roster_id);
  update battlecal.army_weapons set deleted_at = t where roster_id = p_roster_id and deleted_at is null;
  update battlecal.army_units set deleted_at = t where roster_id = p_roster_id and deleted_at is null;
  update battlecal.army_rosters set deleted_at = t where id = p_roster_id;
  return jsonb_build_object('ok', true, 'deleted_at', t);
end $$;

create or replace function public.bc_unit_upsert(p_profile_id uuid, p_password text, p_unit jsonb) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare v_id text := p_unit->>'id'; v_roster text := p_unit->>'roster_id'; cur_roster text;
begin
  if coalesce(v_id, '') = '' or coalesce(v_roster, '') = '' or coalesce(p_unit->>'name', '') = '' then perform battlecal.fail('invalid', 'Einheit unvollstaendig.'); end if;
  if not battlecal.json_size_ok(p_unit) then perform battlecal.fail('invalid', 'Einheit ist zu gross.'); end if;
  select roster_id into cur_roster from battlecal.army_units where id = v_id;
  if cur_roster is not null and cur_roster <> v_roster then perform battlecal.fail('forbidden', 'Einheit gehoert zu einer anderen Armee.'); end if;
  perform battlecal.require_roster_write(p_profile_id, p_password, v_roster);
  insert into battlecal.army_units (id, roster_id, source_file, name, model_count, profile_name, movement_text, toughness, save,
    invulnerable_save, wounds_per_model, leadership_text, objective_control, raw_selection)
  values (v_id, v_roster, coalesce(p_unit->>'source_file', ''), p_unit->>'name', coalesce((p_unit->>'model_count')::integer, 1),
    coalesce(p_unit->>'profile_name', ''), coalesce(p_unit->>'movement_text', ''), (p_unit->>'toughness')::integer, (p_unit->>'save')::integer,
    (p_unit->>'invulnerable_save')::integer, (p_unit->>'wounds_per_model')::integer, coalesce(p_unit->>'leadership_text', ''),
    (p_unit->>'objective_control')::integer, coalesce(p_unit->'raw_selection', '{}'::jsonb))
  on conflict (id) do update set source_file = excluded.source_file, name = excluded.name, model_count = excluded.model_count,
    profile_name = excluded.profile_name, movement_text = excluded.movement_text, toughness = excluded.toughness, save = excluded.save,
    invulnerable_save = excluded.invulnerable_save, wounds_per_model = excluded.wounds_per_model, leadership_text = excluded.leadership_text,
    objective_control = excluded.objective_control, raw_selection = excluded.raw_selection, updated_at = now(), deleted_at = null;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.bc_unit_delete(p_profile_id uuid, p_password text, p_unit_id text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare v_roster text; t timestamptz := now();
begin
  select roster_id into v_roster from battlecal.army_units where id = p_unit_id and deleted_at is null;
  if v_roster is null then perform battlecal.fail('not_found', 'Einheit nicht gefunden.'); end if;
  perform battlecal.require_roster_write(p_profile_id, p_password, v_roster);
  update battlecal.army_weapons set deleted_at = t where unit_id = p_unit_id and deleted_at is null;
  update battlecal.army_units set deleted_at = t where id = p_unit_id;
  return jsonb_build_object('ok', true, 'deleted_at', t);
end $$;

create or replace function public.bc_weapon_upsert(p_profile_id uuid, p_password text, p_weapon jsonb) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare v_id text := p_weapon->>'id'; v_unit text := p_weapon->>'unit_id'; v_roster text; cur_unit text;
begin
  if coalesce(v_id, '') = '' or coalesce(v_unit, '') = '' or coalesce(p_weapon->>'name', '') = '' then perform battlecal.fail('invalid', 'Waffe unvollstaendig.'); end if;
  if not battlecal.json_size_ok(p_weapon) then perform battlecal.fail('invalid', 'Waffe ist zu gross.'); end if;
  select roster_id into v_roster from battlecal.army_units where id = v_unit and deleted_at is null;
  if v_roster is null then perform battlecal.fail('not_found', 'Einheit nicht gefunden.'); end if;
  select unit_id into cur_unit from battlecal.army_weapons where id = v_id;
  if cur_unit is not null and cur_unit <> v_unit then perform battlecal.fail('forbidden', 'Waffe gehoert zu einer anderen Einheit.'); end if;
  perform battlecal.require_roster_write(p_profile_id, p_password, v_roster);
  insert into battlecal.army_weapons (id, roster_id, unit_id, model_id, name, weapon_type, weapon_role, count, range_text, attacks_text,
    skill_text, strength_text, ap_text, damage_text, keywords, raw_profile)
  values (v_id, v_roster, v_unit, p_weapon->>'model_id', p_weapon->>'name', coalesce(p_weapon->>'weapon_type', ''),
    coalesce(p_weapon->>'weapon_role', 'weapon'), coalesce((p_weapon->>'count')::integer, 1), coalesce(p_weapon->>'range_text', ''),
    coalesce(p_weapon->>'attacks_text', ''), coalesce(p_weapon->>'skill_text', ''), coalesce(p_weapon->>'strength_text', ''),
    coalesce(p_weapon->>'ap_text', ''), coalesce(p_weapon->>'damage_text', ''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_weapon->'keywords', '[]'::jsonb)) x), '{}'),
    coalesce(p_weapon->'raw_profile', '{}'::jsonb))
  on conflict (id) do update set model_id = excluded.model_id, name = excluded.name, weapon_type = excluded.weapon_type,
    weapon_role = excluded.weapon_role, count = excluded.count, range_text = excluded.range_text, attacks_text = excluded.attacks_text,
    skill_text = excluded.skill_text, strength_text = excluded.strength_text, ap_text = excluded.ap_text, damage_text = excluded.damage_text,
    keywords = excluded.keywords, raw_profile = excluded.raw_profile, updated_at = now(), deleted_at = null;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.bc_weapon_delete(p_profile_id uuid, p_password text, p_weapon_id text) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare v_roster text;
begin
  select roster_id into v_roster from battlecal.army_weapons where id = p_weapon_id and deleted_at is null;
  if v_roster is null then perform battlecal.fail('not_found', 'Waffe nicht gefunden.'); end if;
  perform battlecal.require_roster_write(p_profile_id, p_password, v_roster);
  update battlecal.army_weapons set deleted_at = now() where id = p_weapon_id;
  return jsonb_build_object('ok', true);
end $$;

-- Rechte: nur die bc_*-RPCs fuer anon/authenticated ausfuehrbar.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'bc\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
