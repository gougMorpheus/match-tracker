-- NUR lokal nach stubs + Migrationen 01, 02 und 03 (frische DB). Prueft Profile ohne Passwort und bc_profile_set_password.
-- Vorbereitung durch den Test-Runner (als Superuser, VOR Migration 03): Profil "ZZ-Import" mit Sperrwert '!' wie nach dem Import.
\set ON_ERROR_STOP on
insert into vault.decrypted_secrets (name, decrypted_secret)
  select 'bc_admin_password_hash', extensions.crypt('dummy-admin', extensions.gen_salt('bf'))
  where not exists (select 1 from vault.decrypted_secrets where name = 'bc_admin_password_hash');
do $$ begin
  if exists (select 1 from battlecal.profiles where password_hash = '!') then raise exception 'FEHLER: Sperrwert nicht zu NULL'; end if;
  if (select password_hash from battlecal.profiles where name = 'ZZ-Import') is not null then raise exception 'FEHLER: Import-Profil hat Hash'; end if;
end $$;
set role anon;
do $$
declare imp uuid; p jsonb; mit jsonb; r jsonb; e text; l jsonb;
  res jsonb := jsonb_build_object('id', 'zz-nopw-1', 'inputs', jsonb_build_object('a', 1), 'outputs', jsonb_build_object('b', 2));
begin
  select (x->>'id')::uuid into imp from jsonb_array_elements(public.bc_profiles_list()) x where x->>'name' = 'ZZ-Import';
  l := public.bc_profiles_list();
  if (select x->>'has_password' from jsonb_array_elements(l) x where x->>'name' = 'ZZ-Import') <> 'false' then raise exception 'FEHLER: has_password %', l; end if;
  if l::text like '%$2%' or l::text like '%password_hash%' then raise exception 'FEHLER: Hash in Liste'; end if;
  -- Ohne Passwort: pruefen, speichern, Armee, Umbenennen (wie im Original)
  r := public.bc_profile_check(imp, ''); if r->'profile'->>'has_password' <> 'false' then raise exception 'FEHLER: check %', r; end if;
  perform public.bc_profile_check(imp, null);
  perform public.bc_result_upsert(imp, '', res);
  perform public.bc_results_upsert_many(imp, null, jsonb_build_array(res || jsonb_build_object('id', 'zz-nopw-2')));
  perform public.bc_roster_upsert(imp, '', jsonb_build_object('id', 'zz-nopw-liste', 'name', 'ZZ Liste'));
  perform public.bc_unit_upsert(imp, '', jsonb_build_object('id', 'zz-nopw-u1', 'roster_id', 'zz-nopw-liste', 'name', 'U1'));
  if jsonb_array_length(public.bc_results_list(imp)) <> 2 then raise exception 'FEHLER: results ohne Passwort'; end if;
  perform public.bc_profile_rename(imp, '', 'ZZ-Import-neu');
  -- Loeschen eines Profils ohne Passwort nur mit Admin-Passwort
  begin perform public.bc_profile_delete(imp, ''); raise exception 'FEHLER: geloescht ohne Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  begin perform public.bc_profile_delete(imp, 'falsch'); raise exception 'FEHLER: geloescht mit falschem Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  -- Passwort setzen: ohne bisheriges frei
  begin perform public.bc_profile_set_password(imp, '', ''); raise exception 'FEHLER: leeres Passwort gesetzt';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  r := public.bc_profile_set_password(imp, '', 'neu-1');
  if r->>'has_password' <> 'true' or r::text like '%neu-1%' then raise exception 'FEHLER: set_password %', r; end if;
  -- jetzt Passwort Pflicht
  begin perform public.bc_result_upsert(imp, '', res); raise exception 'FEHLER: Schreiben ohne Passwort nach Setzen';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  perform public.bc_result_upsert(imp, 'neu-1', res);
  -- aendern: falsches altes -> verboten; altes -> ok; Admin -> ok
  begin perform public.bc_profile_set_password(imp, 'falsch', 'x'); raise exception 'FEHLER: geaendert mit falschem Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  begin perform public.bc_profile_set_password(imp, '', 'x'); raise exception 'FEHLER: geaendert ohne Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  perform public.bc_profile_set_password(imp, 'neu-1', 'neu-2');
  begin perform public.bc_profile_check(imp, 'neu-1'); raise exception 'FEHLER: altes Passwort gilt noch';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  perform public.bc_profile_check(imp, 'neu-2');
  perform public.bc_profile_set_password(imp, 'dummy-admin', 'neu-3');
  perform public.bc_profile_check(imp, 'neu-3');
  -- Profil mit Passwort von Anfang an: unveraendert Pflicht
  mit := public.bc_profile_create('ZZ-Mit', 'pw-mit');
  if mit->>'has_password' <> 'true' then raise exception 'FEHLER: create has_password'; end if;
  begin perform public.bc_result_upsert((mit->>'id')::uuid, '', jsonb_build_object('id', 'zz-mit-1', 'inputs', '{}'::jsonb, 'outputs', '{}'::jsonb));
    raise exception 'FEHLER: Schreiben ohne Passwort bei Profil mit Passwort';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  -- fremdes Ergebnis bleibt geschuetzt, auch von einem Profil ohne Passwort aus
  begin perform public.bc_result_upsert((mit->>'id')::uuid, 'pw-mit', res); raise exception 'FEHLER: fremdes Ergebnis ueberschrieben';
  exception when raise_exception then get stacked diagnostics e = message_text; if e like 'FEHLER%' then raise; end if; end;
  -- Admin loescht Profil (auch ohne Passwort-Fall: zweites Import-Profil)
  perform public.bc_profile_delete(imp, 'dummy-admin');
  raise notice 'OK battlecal_nopw_local_test';
end $$;
reset role;
do $$ begin
  if exists (select 1 from battlecal.profiles where password_hash is not null and password_hash not like '$2%') then raise exception 'FEHLER: kein bcrypt'; end if;
end $$;
