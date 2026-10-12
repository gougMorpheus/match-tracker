-- SQL-Tests Sync-Absicherung (Phase 1 + 2). Laufen als Rolle anon, alles in einer Transaktion mit
-- abschliessendem ROLLBACK: hinterlaesst keine Daten. Aufruf: psql -v ON_ERROR_STOP=1 -f ...
begin;
set local role anon;
do $$
declare
  gid uuid := '7e570000-0000-4000-8000-000000000001';
  game jsonb := jsonb_build_object('id', gid, 'player1_name', 'ZZ-TEST-SQL A', 'player1_army', 'X',
    'player1_max_points', 1000, 'player2_name', 'ZZ-TEST-SQL B', 'player2_army', 'Y', 'player2_max_points', 1000);
  r jsonb; ok boolean; cnt int; t1 timestamptz; t2 timestamptz;
  ev1 uuid := '7e570000-0000-4000-8000-0000000000e1';
  ev2 uuid := '7e570000-0000-4000-8000-0000000000e2';
  sc1 uuid := '7e570000-0000-4000-8000-0000000000c1';
  sc2 uuid := '7e570000-0000-4000-8000-0000000000c2';
begin
  -- 1 Direktes Schreiben ist gesperrt
  begin insert into public.games (player1_name, player1_army, player1_max_points, player2_name, player2_army, player2_max_points)
    values ('ZZ-TEST','a',1,'b','c',1); ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, '1: direktes INSERT games muss verboten sein';
  begin update public.events set note = 'x' where false; ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, '1: direktes UPDATE events muss verboten sein';

  -- 2 Anlegen per RPC
  r := public.mt_save_game(game, null);
  assert (r->>'created')::boolean and (r->>'version')::int = 1 and (r->>'flow_version')::int = 1, '2: anlegen ' || r;

  -- 3 Zeile aendern mit richtiger Version, dann veraltete Version -> PT409
  r := public.mt_save_game(game || '{"deployment":"D1"}', 1);
  assert (r->>'version')::int = 2, '3: version 2 ' || r;
  begin perform public.mt_save_game(game || '{"deployment":"D2"}', 1); ok := false;
  exception when sqlstate 'PT409' then ok := true; end;
  assert ok, '3: veraltete games-Version muss 409 liefern';
  -- unveraenderter Snapshot mit alter Version ist kein Konflikt (noop, matched=false)
  r := public.mt_save_game(game || '{"deployment":"D1"}', 1);
  assert (r->>'noop')::boolean and not (r->>'matched')::boolean, '3: noop ' || r;

  -- 4 Gleichzeitig "Weiter": zwei turn-start fuer denselben Zug, beide mit flow_version 1
  r := public.mt_put_event(jsonb_build_object('id', ev1, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 1, 'event_type', 'turn-start', 'occurred_at', '2001-01-01T00:00:00Z'), 1, 0);
  assert (r->>'flow_version')::int = 2 and (r->>'matched')::boolean, '4: erster Zugwechsel ' || r;
  t1 := (r->'event'->>'occurred_at')::timestamptz;
  assert t1 > now() - interval '1 minute', '4: Serverzeit statt Client-Zeit (verstellte Uhr) ' || t1;
  begin perform public.mt_put_event(jsonb_build_object('id', ev2, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 2, 'event_type', 'turn-start'), 1, 0); ok := false;
  exception when sqlstate 'PT409' then ok := true; end;
  assert ok, '4: zweiter Zugwechsel mit alter flow_version muss 409 liefern';
  -- Unique-Index greift auch bei aktueller Version
  begin perform public.mt_put_event(jsonb_build_object('id', ev2, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 2, 'event_type', 'turn-start'), 2, 0); ok := false;
  exception when sqlstate 'PT409' then ok := true; end;
  assert ok, '4: doppelter turn-start muss am Unique-Index scheitern';

  -- 5 Start/Stopp gekreuzt: pause mit v2 ok, resume mit v2 -> 409
  r := public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-0000000000a1', 'game_id', gid,
    'round_number', 1, 'turn_number', 1, 'player_slot', 1, 'event_type', 'turn-pause'), 2, 0);
  assert (r->>'flow_version')::int = 3, '5: pause ' || r;
  t2 := (r->'event'->>'occurred_at')::timestamptz;
  assert t2 >= t1, '5: Ablaufzeiten monoton';
  begin perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-0000000000a2', 'game_id', gid,
    'round_number', 1, 'turn_number', 1, 'player_slot', 1, 'event_type', 'turn-resume'), 2, 0); ok := false;
  exception when sqlstate 'PT409' then ok := true; end;
  assert ok, '5: gekreuzter Resume muss 409 liefern';
  -- Offline nachgespielt: Wartezeit 10 min -> Zeit nie vor letztem Ablauf-Ereignis
  r := public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-0000000000a3', 'game_id', gid,
    'round_number', 1, 'turn_number', 1, 'player_slot', 1, 'event_type', 'turn-resume'), 3, 600000);
  assert (r->'event'->>'occurred_at')::timestamptz >= t2, '5: Offline-Zeit geklemmt ' || r;

  -- 6 Notizen/Punkte gleichzeitig: kommutativ, beide mit alter Version ok, kein flow-Bump
  r := public.mt_put_event(jsonb_build_object('id', sc1, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 1, 'event_type', 'note', 'note', 'Notiz A'), 1, 0);
  assert not (r->>'matched')::boolean and (r->>'flow_version')::int = 4, '6: Notiz A ' || r;
  r := public.mt_put_event(jsonb_build_object('id', sc2, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 2, 'event_type', 'note', 'note', 'Notiz B'), 1, 0);
  select count(*) into cnt from public.events where game_id = gid and event_type = 'note';
  assert cnt = 2, '6: beide Notizen vorhanden';
  -- Idempotenz (Queue-Wiederholung)
  r := public.mt_put_event(jsonb_build_object('id', sc2, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 2, 'event_type', 'note', 'note', 'Notiz B'), 4, 0);
  assert (r->>'noop')::boolean, '6: Wiederholung ist noop';

  -- 7 Undo als Gegenereignis
  r := public.mt_revoke_event(gid, sc1, 1);
  select count(*) into cnt from public.events where game_id = gid and event_type = 'note';
  assert cnt = 1, '7: zurueckgenommene Notiz unsichtbar';
  r := public.mt_revoke_event(gid, sc1, 1);
  assert (r->>'noop')::boolean, '7: doppeltes Undo ist noop';
  begin perform public.mt_revoke_event(gid, ev1, 1); ok := false;
  exception when sqlstate 'PT409' then ok := true; end;
  assert ok, '7: Undo eines Ablauf-Ereignisses mit alter Version -> 409';
  r := public.mt_revoke_event(gid, '7e570000-0000-4000-8000-0000000000a3', 4);
  assert (r->>'flow_version')::int = 5, '7: Undo Ablauf ' || r;
  -- Redo stellt dasselbe Ereignis wieder her
  r := public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-0000000000a3', 'game_id', gid,
    'round_number', 1, 'turn_number', 1, 'player_slot', 1, 'event_type', 'turn-resume'), 5, 0);
  assert (r->>'flow_version')::int = 6 and r->'event'->>'revoked_by' is null, '7: Redo ' || r;
  -- nach Undo ist neuer Zugwechsel im selben Zug wieder moeglich
  r := public.mt_revoke_event(gid, ev1, 6);
  r := public.mt_put_event(jsonb_build_object('id', ev2, 'game_id', gid, 'round_number', 1, 'turn_number', 1,
    'player_slot', 2, 'event_type', 'turn-start'), 7, 0);
  assert (r->>'flow_version')::int = 8, '7: neuer Zugwechsel nach Undo ' || r;

  -- 8 Unbekanntes Spiel / Audit-Typen
  begin perform public.mt_put_event(jsonb_build_object('id', gen_random_uuid(), 'game_id', gen_random_uuid(),
    'player_slot', 1, 'event_type', 'note'), 1, 0); ok := false;
  exception when sqlstate 'PT404' then ok := true; end;
  assert ok, '8: fehlendes Spiel -> 404';
  begin perform public.mt_put_event(jsonb_build_object('id', gen_random_uuid(), 'game_id', gid,
    'player_slot', 1, 'event_type', 'revoke'), 8, 0); ok := false;
  exception when sqlstate '22023' then ok := true; end;
  assert ok, '8: Audit-Typ von aussen verboten';

  -- 9 Loeschen
  r := public.mt_delete_game(gid, null);
  begin perform public.mt_save_game(game || '{"deployment":"D9"}', (r->>'version')::bigint); ok := false;
  exception when sqlstate 'PT409' then ok := true; end;
  assert ok, '9: Aenderung an geloeschtem Spiel -> 409';
  assert (public.mt_schema_info()->>'schema_version')::int = 2, '9: schema_info';
  raise notice 'SQL-TESTS OK';
end $$;
rollback;
