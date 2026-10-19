-- NUR lokal nach stubs + Migrationen 01 und 02 (frische DB). Prueft bc_roster_import und bc_results_upsert_many.
\set ON_ERROR_STOP on
insert into vault.decrypted_secrets (name, decrypted_secret)
  select 'bc_admin_password_hash', extensions.crypt('dummy-admin', extensions.gen_salt('bf'))
  where not exists (select 1 from vault.decrypted_secrets where name = 'bc_admin_password_hash');
set role anon;
do $$
declare p jsonb; q jsonb; r jsonb; e text; long_id text := 'profile-' || repeat('x', 36) || '-' || repeat('s', 80);
  u1 text; w1 text;
begin
  p := public.bc_profile_create('ZZ-App', 'pw-app');
  q := public.bc_profile_create('ZZ-Andere', 'pw-andere');
  u1 := long_id || '::' || repeat('a', 36); w1 := u1 || '::' || repeat('b', 36) || '::' || repeat('c', 36);
  if length(w1) <= 200 then raise exception 'FEHLER: Testaufbau, ID zu kurz'; end if;
  -- Import mit langen IDs (wie die Original-App), Passwort Pflicht
  begin perform public.bc_roster_import((p->>'id')::uuid, 'falsch', jsonb_build_object('id', long_id, 'name', 'ZZ Liste'),
      jsonb_build_array(jsonb_build_object('id', u1, 'name', 'U1')), '[]'); raise exception 'FEHLER: Import ohne Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  r := public.bc_roster_import((p->>'id')::uuid, 'pw-app', jsonb_build_object('id', long_id, 'name', 'ZZ Liste', 'source_file', 'a.json'),
    jsonb_build_array(jsonb_build_object('id', u1, 'name', 'U1', 'toughness', 4, 'raw_selection', jsonb_build_object('k', 1)),
                      jsonb_build_object('id', u1 || '-2', 'name', 'U2')),
    jsonb_build_array(jsonb_build_object('id', w1, 'unit_id', u1, 'name', 'Bolter', 'keywords', jsonb_build_array('Rapid Fire 1'), 'raw_profile', jsonb_build_object('z', 2)),
                      jsonb_build_object('id', w1 || '-2', 'unit_id', u1 || '-2', 'name', 'Klinge')));
  if (r->>'units')::int <> 2 or (r->>'weapons')::int <> 2 then raise exception 'FEHLER: Import-Zaehler %', r; end if;
  r := public.bc_roster_get(long_id, true);
  if jsonb_array_length(r->'units') <> 2 or jsonb_array_length(r->'weapons') <> 2 or r->'units'->0->'raw_selection'->>'k' <> '1' then raise exception 'FEHLER: roster_get %', r; end if;
  if r->'roster'->>'profile_id' <> p->>'id' then raise exception 'FEHLER: Besitzer'; end if;
  -- Re-Import ersetzt: U2 und Klinge fallen weg (weich), U1 bleibt
  perform public.bc_roster_import((p->>'id')::uuid, 'pw-app', jsonb_build_object('id', long_id, 'name', 'ZZ Liste neu'),
    jsonb_build_array(jsonb_build_object('id', u1, 'name', 'U1', 'toughness', 5)),
    jsonb_build_array(jsonb_build_object('id', w1, 'unit_id', u1, 'name', 'Bolter')));
  r := public.bc_roster_get(long_id, false);
  if jsonb_array_length(r->'units') <> 1 or (r->'units'->0->>'toughness')::int <> 5 or jsonb_array_length(r->'weapons') <> 1 or r->'roster'->>'name' <> 'ZZ Liste neu' then
    raise exception 'FEHLER: Re-Import %', r; end if;
  -- Fremdes Profil darf die Liste nicht importieren/ueberschreiben, auch nicht ueber fremde Einheiten-IDs
  begin perform public.bc_roster_import((q->>'id')::uuid, 'pw-andere', jsonb_build_object('id', long_id, 'name', 'X'), jsonb_build_array(jsonb_build_object('id', 'neu', 'name', 'N')), '[]');
    raise exception 'FEHLER: fremde Liste ueberschrieben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  begin perform public.bc_roster_import((q->>'id')::uuid, 'pw-andere', jsonb_build_object('id', 'zz-andere', 'name', 'X'), jsonb_build_array(jsonb_build_object('id', u1, 'name', 'N')), '[]');
    raise exception 'FEHLER: fremde Einheit uebernommen';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  -- Waffe ohne passende Einheit wird abgelehnt
  begin perform public.bc_roster_import((p->>'id')::uuid, 'pw-app', jsonb_build_object('id', 'zz-r2', 'name', 'R2'), jsonb_build_array(jsonb_build_object('id', 'zz-r2-u', 'name', 'N')),
      jsonb_build_array(jsonb_build_object('id', 'zz-r2-w', 'unit_id', 'gibtsnicht', 'name', 'W'))); raise exception 'FEHLER: Waffe ohne Einheit';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  if public.bc_roster_get('zz-r2') is not null then raise exception 'FEHLER: abgelehnter Import hat Reste hinterlassen'; end if;
  -- Mehrere Ergebnisse auf einmal
  r := public.bc_results_upsert_many((p->>'id')::uuid, 'pw-app', jsonb_build_array(
    jsonb_build_object('id', 'm1', 'created_at', '2026-10-19T07:00:00Z', 'inputs', '{}'::jsonb, 'outputs', '{}'::jsonb),
    jsonb_build_object('id', 'm2', 'created_at', '2026-10-19T08:00:00Z', 'custom_title', 'T', 'inputs', '{}'::jsonb, 'outputs', '{}'::jsonb)));
  if (r->>'count')::int <> 2 or jsonb_array_length(public.bc_results_list((p->>'id')::uuid, 50)) <> 2 then raise exception 'FEHLER: upsert_many %', r; end if;
  begin perform public.bc_results_upsert_many((q->>'id')::uuid, 'pw-andere', jsonb_build_array(jsonb_build_object('id', 'm1', 'inputs', '{}'::jsonb, 'outputs', '{}'::jsonb)));
    raise exception 'FEHLER: fremde Ergebnisse ueberschrieben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  begin perform public.bc_results_upsert_many((p->>'id')::uuid, 'dummy-admin', '[]'); raise exception 'FEHLER: Admin darf Historie schreiben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  if (public.bc_results_upsert_many((p->>'id')::uuid, 'pw-app', '[]'))->>'count' <> '0' then raise exception 'FEHLER: leer'; end if;
  raise notice 'App-Tests OK';
end $$;
reset role;
do $$
declare n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('bc_roster_import', 'bc_results_upsert_many')
    and p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=battlecal%' and has_function_privilege('anon', p.oid, 'execute');
  if n <> 2 then raise exception 'FEHLER: neue RPCs Rechte/definer %', n; end if;
  select count(*) into n from battlecal.army_units where deleted_at is not null; if n <> 1 then raise exception 'FEHLER: weich geloeschte Einheiten %', n; end if;
  raise notice 'App-Admin-Tests OK';
end $$;
