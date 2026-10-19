-- Battle-Cal im Match-Tracker, Stufe D2: Ergaenzungen fuer die App (nur public.bc_* und Schema battlecal).
-- Unveraendert: public.games/events, mt_*-Funktionen, Realtime-Publikation, PostgREST-Einstellungen.
-- 1) ID-Laengen: Die Original-App erzeugt IDs wie "profile-<uuid>-<slug bis 80>::<sel>::<node>::<profil>" (bis ca. 240 Zeichen).
--    Die Basis-Migration erlaubte 120/200 Zeichen -> Import grosser Listen waere gescheitert. Neu: 500 Zeichen.
-- 2) bc_roster_import: Armeeliste (New-Recruit-Import) in EINEM Aufruf ersetzen (frueher: DELETE + viele POSTs).
--    Einheiten/Waffen der Armee, die nicht mehr in der Datei stehen, werden weich geloescht.
-- 3) bc_results_upsert_many: mehrere Historien-Eintraege in einem Aufruf (Profil anlegen, Historie importieren, Umzug).
-- Rollback: 20261019_02_battlecal_app.rollback.sql

alter table battlecal.results      drop constraint if exists results_id_check;
alter table battlecal.results      add  constraint results_id_check      check (length(id) between 1 and 500);
alter table battlecal.army_rosters drop constraint if exists army_rosters_id_check;
alter table battlecal.army_rosters add  constraint army_rosters_id_check check (length(id) between 1 and 500);
alter table battlecal.army_units   drop constraint if exists army_units_id_check;
alter table battlecal.army_units   add  constraint army_units_id_check   check (length(id) between 1 and 500);
alter table battlecal.army_weapons drop constraint if exists army_weapons_id_check;
alter table battlecal.army_weapons add  constraint army_weapons_id_check check (length(id) between 1 and 500);

create or replace function public.bc_roster_import(p_profile_id uuid, p_password text, p_roster jsonb, p_units jsonb, p_weapons jsonb)
returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare
  v_id text := p_roster->>'id';
  t timestamptz := now();
  n_units integer; n_weapons integer;
begin
  perform battlecal.require_profile(p_profile_id, p_password, false);
  if coalesce(v_id, '') = '' or coalesce(p_roster->>'name', '') = '' then perform battlecal.fail('invalid', 'Armee unvollstaendig.'); end if;
  if jsonb_typeof(coalesce(p_units, 'null'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_weapons, 'null'::jsonb)) <> 'array' then
    perform battlecal.fail('invalid', 'Einheiten/Waffen fehlen.');
  end if;
  n_units := jsonb_array_length(p_units); n_weapons := jsonb_array_length(p_weapons);
  if n_units = 0 then perform battlecal.fail('invalid', 'Keine Einheiten.'); end if;
  if n_units > 2000 or n_weapons > 20000 then perform battlecal.fail('invalid', 'Armeeliste ist zu gross.'); end if;
  if not battlecal.json_size_ok(p_units, 8388608) or not battlecal.json_size_ok(p_weapons, 8388608) then
    perform battlecal.fail('invalid', 'Armeeliste ist zu gross.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_units) u where coalesce(u->>'id', '') = '' or coalesce(u->>'name', '') = '')
     or exists (select 1 from jsonb_array_elements(p_weapons) w where coalesce(w->>'id', '') = '' or coalesce(w->>'name', '') = '' or coalesce(w->>'unit_id', '') = '') then
    perform battlecal.fail('invalid', 'Einheit oder Waffe unvollstaendig.');
  end if;
  if exists (select 1 from jsonb_array_elements(p_weapons) w
             where not exists (select 1 from jsonb_array_elements(p_units) u where u->>'id' = w->>'unit_id')) then
    perform battlecal.fail('invalid', 'Waffe ohne Einheit.');
  end if;
  -- Fremde IDs (andere Armee) nie ueberschreiben.
  if exists (select 1 from battlecal.army_units x join jsonb_array_elements(p_units) u on x.id = u->>'id' where x.roster_id <> v_id)
     or exists (select 1 from battlecal.army_weapons x join jsonb_array_elements(p_weapons) w on x.id = w->>'id' where x.roster_id <> v_id) then
    perform battlecal.fail('forbidden', 'Einheit oder Waffe gehoert zu einer anderen Armee.');
  end if;

  if exists (select 1 from battlecal.army_rosters where id = v_id) then
    perform battlecal.require_roster_write(p_profile_id, p_password, v_id);
    update battlecal.army_rosters set name = p_roster->>'name', source_file = coalesce(p_roster->>'source_file', source_file),
      catalogue_name = coalesce(p_roster->>'catalogue_name', catalogue_name), game_system_name = coalesce(p_roster->>'game_system_name', game_system_name),
      updated_at = t, deleted_at = null where id = v_id;
  else
    insert into battlecal.army_rosters (id, profile_id, name, source_file, catalogue_name, game_system_name)
    values (v_id, p_profile_id, p_roster->>'name', coalesce(p_roster->>'source_file', ''), coalesce(p_roster->>'catalogue_name', ''),
            coalesce(p_roster->>'game_system_name', ''));
  end if;

  -- Wie frueher "ersetzen": alles Alte der Armee weich loeschen, dann die Datei-Inhalte wieder aktivieren/anlegen.
  update battlecal.army_weapons set deleted_at = t where roster_id = v_id and deleted_at is null;
  update battlecal.army_units set deleted_at = t where roster_id = v_id and deleted_at is null;

  insert into battlecal.army_units (id, roster_id, source_file, name, model_count, profile_name, movement_text, toughness, save,
    invulnerable_save, wounds_per_model, leadership_text, objective_control, raw_selection)
  select u->>'id', v_id, coalesce(u->>'source_file', ''), u->>'name', coalesce((u->>'model_count')::integer, 1),
    coalesce(u->>'profile_name', ''), coalesce(u->>'movement_text', ''), (u->>'toughness')::integer, (u->>'save')::integer,
    (u->>'invulnerable_save')::integer, (u->>'wounds_per_model')::integer, coalesce(u->>'leadership_text', ''),
    (u->>'objective_control')::integer, coalesce(u->'raw_selection', '{}'::jsonb)
  from jsonb_array_elements(p_units) u
  on conflict (id) do update set source_file = excluded.source_file, name = excluded.name, model_count = excluded.model_count,
    profile_name = excluded.profile_name, movement_text = excluded.movement_text, toughness = excluded.toughness, save = excluded.save,
    invulnerable_save = excluded.invulnerable_save, wounds_per_model = excluded.wounds_per_model, leadership_text = excluded.leadership_text,
    objective_control = excluded.objective_control, raw_selection = excluded.raw_selection, updated_at = t, deleted_at = null;

  insert into battlecal.army_weapons (id, roster_id, unit_id, model_id, name, weapon_type, weapon_role, count, range_text, attacks_text,
    skill_text, strength_text, ap_text, damage_text, keywords, raw_profile)
  select w->>'id', v_id, w->>'unit_id', w->>'model_id', w->>'name', coalesce(w->>'weapon_type', ''),
    coalesce(w->>'weapon_role', 'weapon'), coalesce((w->>'count')::integer, 1), coalesce(w->>'range_text', ''),
    coalesce(w->>'attacks_text', ''), coalesce(w->>'skill_text', ''), coalesce(w->>'strength_text', ''),
    coalesce(w->>'ap_text', ''), coalesce(w->>'damage_text', ''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(w->'keywords') = 'array' then w->'keywords' else '[]'::jsonb end) x), '{}'),
    coalesce(w->'raw_profile', '{}'::jsonb)
  from jsonb_array_elements(p_weapons) w
  on conflict (id) do update set unit_id = excluded.unit_id, model_id = excluded.model_id, name = excluded.name, weapon_type = excluded.weapon_type,
    weapon_role = excluded.weapon_role, count = excluded.count, range_text = excluded.range_text, attacks_text = excluded.attacks_text,
    skill_text = excluded.skill_text, strength_text = excluded.strength_text, ap_text = excluded.ap_text, damage_text = excluded.damage_text,
    keywords = excluded.keywords, raw_profile = excluded.raw_profile, updated_at = t, deleted_at = null;

  return jsonb_build_object('ok', true, 'id', v_id, 'units', n_units, 'weapons', n_weapons);
end $$;

create or replace function public.bc_results_upsert_many(p_profile_id uuid, p_password text, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = battlecal, extensions, pg_temp as $$
declare n integer;
begin
  perform battlecal.require_profile(p_profile_id, p_password, false);
  if jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' then perform battlecal.fail('invalid', 'Ergebnisse fehlen.'); end if;
  n := jsonb_array_length(p_results);
  if n = 0 then return jsonb_build_object('ok', true, 'count', 0); end if;
  if n > 200 then perform battlecal.fail('invalid', 'Zu viele Ergebnisse auf einmal (max. 200).'); end if;
  if exists (select 1 from jsonb_array_elements(p_results) r
             where coalesce(r->>'id', '') = '' or r->'inputs' is null or r->'outputs' is null or not battlecal.json_size_ok(r)) then
    perform battlecal.fail('invalid', 'Ergebnis unvollstaendig oder zu gross.');
  end if;
  if exists (select 1 from battlecal.results x join jsonb_array_elements(p_results) r on x.id = r->>'id' where x.profile_id <> p_profile_id) then
    perform battlecal.fail('forbidden', 'Ergebnis gehoert zu einem anderen Profil.');
  end if;
  insert into battlecal.results (id, profile_id, created_at, custom_title, inputs, outputs)
  select distinct on (r->>'id') r->>'id', p_profile_id, coalesce((r->>'created_at')::timestamptz, now()), coalesce(r->>'custom_title', ''),
         r->'inputs', r->'outputs'
  from jsonb_array_elements(p_results) r
  on conflict (id) do update set custom_title = excluded.custom_title, inputs = excluded.inputs, outputs = excluded.outputs,
    created_at = excluded.created_at, updated_at = now(), deleted_at = null;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- Rechte wie in der Basis-Migration: nur die bc_*-RPCs fuer anon/authenticated ausfuehrbar.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('bc_roster_import', 'bc_results_upsert_many') loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
