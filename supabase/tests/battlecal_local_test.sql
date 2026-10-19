-- NUR lokal nach stubs + Migration. Bricht bei jedem Fehler ab (ON_ERROR_STOP). Test-Admin-Passwort ist ein Dummy.
\set ON_ERROR_STOP on
insert into vault.decrypted_secrets (name, decrypted_secret) values ('bc_admin_password_hash', extensions.crypt('dummy-admin', extensions.gen_salt('bf')));
create temp table snap_before as select (select md5(string_agg(proname||prosrc, ',' order by proname)) from pg_proc where proname like 'mt\_%') mt_fn,
  (select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime') pub;
grant select on snap_before to anon;
set role anon;
do $$
declare p jsonb; q jsonb; r jsonb; ok boolean; e text;
begin
  -- direkter Tabellenzugriff fuer anon verboten
  begin perform 1 from battlecal.profiles; raise exception 'FEHLER: anon liest battlecal.profiles'; exception when insufficient_privilege then null; end;
  begin insert into battlecal.results(id, profile_id, created_at, inputs, outputs) values ('x', gen_random_uuid(), now(), '{}', '{}'); raise exception 'FEHLER: anon schreibt';
  exception when insufficient_privilege then null; end;
  begin perform battlecal.admin_ok('dummy-admin'); raise exception 'FEHLER: anon ruft internen Helfer'; exception when insufficient_privilege then null; end;
  -- Profil anlegen, kein Hash in der Antwort
  p := public.bc_profile_create('ZZ-Test', 'geheim1');
  if p ? 'password_hash' or p::text like '%$2%' then raise exception 'FEHLER: Hash in Antwort'; end if;
  if (public.bc_profiles_list())::text like '%password%' then raise exception 'FEHLER: Passwort in Liste'; end if;
  begin perform public.bc_profile_create('zz-test', 'x'); raise exception 'FEHLER: doppelter Name'; exception when raise_exception then
    get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  -- Schreiben verlangt Profil-Passwort
  begin perform public.bc_result_upsert((p->>'id')::uuid, 'falsch', '{"id":"r1","inputs":{},"outputs":{}}'); raise exception 'FEHLER: falsches Passwort akzeptiert';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  begin perform public.bc_result_upsert((p->>'id')::uuid, 'dummy-admin', '{"id":"r1","inputs":{},"outputs":{}}'); raise exception 'FEHLER: Admin darf Historie schreiben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  perform public.bc_result_upsert((p->>'id')::uuid, 'geheim1', '{"id":"r1","created_at":"2026-10-19T08:00:00Z","custom_title":"A","inputs":{"a":1},"outputs":{"b":2}}');
  perform public.bc_result_upsert((p->>'id')::uuid, 'geheim1', '{"id":"r2","created_at":"2026-10-19T09:00:00Z","inputs":{},"outputs":{}}');
  r := public.bc_results_list((p->>'id')::uuid, 50);
  if jsonb_array_length(r) <> 2 or r->0->>'id' <> 'r2' then raise exception 'FEHLER: Historie %', r; end if;
  perform public.bc_result_delete((p->>'id')::uuid, 'geheim1', 'r2');
  if jsonb_array_length(public.bc_results_list((p->>'id')::uuid, 50)) <> 1 then raise exception 'FEHLER: weich loeschen Ergebnis'; end if;
  -- zweites Profil darf fremdes Ergebnis nicht uebernehmen
  q := public.bc_profile_create('ZZ-Zwei', 'pw2');
  begin perform public.bc_result_upsert((q->>'id')::uuid, 'pw2', '{"id":"r1","inputs":{},"outputs":{}}'); raise exception 'FEHLER: fremdes Ergebnis ueberschrieben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  -- Armee
  perform public.bc_roster_upsert((p->>'id')::uuid, 'geheim1', '{"id":"zz-roster","name":"ZZ Armee"}');
  perform public.bc_unit_upsert((p->>'id')::uuid, 'geheim1', '{"id":"zz-u1","roster_id":"zz-roster","name":"Einheit","toughness":4,"raw_selection":{"big":true}}');
  perform public.bc_weapon_upsert((p->>'id')::uuid, 'geheim1', '{"id":"zz-w1","unit_id":"zz-u1","name":"Gewehr","keywords":["Rapid Fire 1"],"raw_profile":{"x":1}}');
  begin perform public.bc_unit_upsert((q->>'id')::uuid, 'pw2', '{"id":"zz-u2","roster_id":"zz-roster","name":"X"}'); raise exception 'FEHLER: fremde Armee beschrieben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  r := public.bc_roster_get('zz-roster');
  if jsonb_array_length(r->'units') <> 1 or (r->'units'->0) ? 'raw_selection' or (r->'weapons'->0) ? 'raw_profile' then raise exception 'FEHLER: roster_get ohne raw %', r; end if;
  if not ((public.bc_roster_get('zz-roster', true))->'units'->0 ? 'raw_selection') then raise exception 'FEHLER: roster_get mit raw'; end if;
  if r->'weapons'->0->'keywords'->>0 <> 'Rapid Fire 1' then raise exception 'FEHLER: keywords'; end if;
  if jsonb_array_length(public.bc_rosters_list((p->>'id')::uuid)) <> 1 then raise exception 'FEHLER: rosters_list'; end if;
  -- Umbenennen mit Admin-Passwort erlaubt, ohne Passwort nicht
  begin perform public.bc_profile_rename((q->>'id')::uuid, '', 'ZZ-Neu'); raise exception 'FEHLER: Umbenennen ohne Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  perform public.bc_profile_rename((q->>'id')::uuid, 'dummy-admin', 'ZZ-Neu');
  -- Profil loeschen: falsches Passwort nein, Admin-Passwort ja, danach alles weich geloescht
  begin perform public.bc_profile_delete((p->>'id')::uuid, 'falsch'); raise exception 'FEHLER: Loeschen mit falschem Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  perform public.bc_profile_delete((p->>'id')::uuid, 'dummy-admin');
  if jsonb_array_length(public.bc_profiles_list()) <> 1 then raise exception 'FEHLER: Profil nicht weg aus Liste'; end if;
  if public.bc_roster_get('zz-roster') is not null then raise exception 'FEHLER: Armee nach Profil-Loeschung sichtbar'; end if;
  if jsonb_array_length(public.bc_results_list((p->>'id')::uuid, 50)) <> 0 then raise exception 'FEHLER: Historie nach Loeschung sichtbar'; end if;
  -- Name nach weichem Loeschen wieder frei
  perform public.bc_profile_create('ZZ-Test', 'neu');
  raise notice 'anon-Tests OK';
end $$;
reset role;
do $$
declare n integer; b record;
begin
  select count(*) into n from battlecal.profiles where deleted_at is not null; if n <> 1 then raise exception 'FEHLER: weich geloescht erwartet 1, ist %', n; end if;
  select count(*) into n from battlecal.results where deleted_at is not null; if n <> 2 then raise exception 'FEHLER: results geloescht %', n; end if;
  select count(*) into n from battlecal.profiles where password_hash not like '$2a$%'; if n <> 0 then raise exception 'FEHLER: kein bcrypt'; end if;
  select * into b from snap_before;
  if b.mt_fn is distinct from (select md5(string_agg(proname||prosrc, ',' order by proname)) from pg_proc where proname like 'mt\_%') then raise exception 'FEHLER: mt_* veraendert'; end if;
  if b.pub is distinct from (select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime') then raise exception 'FEHLER: Publikation veraendert'; end if;
  select count(*) into n from information_schema.role_table_grants where table_schema = 'battlecal' and grantee in ('anon','authenticated','PUBLIC');
  if n <> 0 then raise exception 'FEHLER: Tabellenrechte fuer anon %', n; end if;
  select count(*) into n from pg_policies where schemaname = 'battlecal'; if n <> 0 then raise exception 'FEHLER: Policies vorhanden'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'bc\_%'
    and not (p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=%'); if n <> 0 then raise exception 'FEHLER: bc_* ohne definer/search_path %', n; end if;
  raise notice 'Admin-Tests OK';
end $$;
