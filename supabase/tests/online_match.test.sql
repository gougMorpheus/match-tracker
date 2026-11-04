-- SQL-Tests Online-Flag + HUD. Voraussetzung: Migrationen 20261012_01, 20261012_02 und
-- 20261104_01 sind angewandt. Läuft als anon, eine Transaktion, am Ende ROLLBACK.
-- Aufruf: psql -v ON_ERROR_STOP=1 -f supabase/tests/online_match.test.sql
begin;
set local role anon;
do $$
declare
  gid uuid := '7e570000-0000-4000-8000-0000000000a1';
  game jsonb := jsonb_build_object('id', gid, 'player1_name', 'ZZ-ONLINE A', 'player1_army', 'X',
    'player1_max_points', 1000, 'player2_name', 'ZZ-ONLINE B', 'player2_army', 'Y', 'player2_max_points', 1000,
    'defender_player', 2, 'starting_player', 1);
  r jsonb;
  hud jsonb;
  ok boolean;
  online boolean;
  ver bigint;
begin
  assert (public.mt_schema_info()->>'schema_version')::int = 3, 'schema_version 3';
  assert (public.mt_schema_info()->>'min_app_schema')::int = 2, 'min_app_schema bleibt 2';

  r := public.mt_save_game(game, null);
  assert (r->>'created')::boolean, 'anlegen ' || r;
  select is_online into online from public.games where id = gid;
  assert online = false, 'ohne Schlüssel ist is_online false';

  r := public.mt_save_game(game || '{"is_online":true}', 1);
  assert (r->>'version')::int = 2, 'online setzt version ' || r;
  select is_online, version into online, ver from public.games where id = gid;
  assert online and ver = 2, 'is_online true gespeichert';

  r := public.mt_save_game(game, 2);
  assert (r->>'noop')::boolean, 'alter Client ohne is_online ändert die Spalte nicht ' || r;
  select is_online into online from public.games where id = gid;
  assert online, 'Flag bleibt true';

  begin
    perform public.mt_save_game(game || '{"is_online":false}', 1);
    ok := false;
  exception when sqlstate 'PT409' then ok := true;
  end;
  assert ok, 'veraltete Version beim Flag bleibt 409';

  r := public.mt_save_game(game || '{"is_online":false}', 2);
  assert (r->>'version')::int = 3, 'Flag aus ' || r;
  select is_online into online from public.games where id = gid;
  assert online = false, 'is_online false';
  r := public.mt_save_game(game || '{"is_online":true}', 3);

  -- Aufstellung
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000011', 'game_id', gid,
    'player_slot', 1, 'event_type', 'game-start', 'occurred_at', '2026-11-04T10:00:00Z'), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000012', 'game_id', gid,
    'player_slot', 1, 'event_type', 'setup-start', 'occurred_at', '2026-11-04T10:00:01Z'), 2, 0);
  hud := public.mt_match_hud(gid);
  assert (hud->>'found')::boolean and (hud->>'is_online')::boolean, 'hud gefunden ' || hud;
  assert hud->>'phase' = 'setup' and (hud->>'round')::int = 0 and hud->'active_turn' = 'null'::jsonb, 'aufstellung ' || hud;
  assert (hud->>'active_player_slot')::int = 1, 'aufstellung startspieler';
  assert (hud->'scores'->>'1')::numeric = 0 and (hud->'cp'->>'1')::numeric = 0, 'leer';

  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000021', 'game_id', gid,
    'player_slot', 1, 'event_type', 'score-primary', 'value_number', -3, 'round_number', 1, 'turn_number', 1), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000022', 'game_id', gid,
    'player_slot', 1, 'event_type', 'score-secondary', 'value_number', 5, 'round_number', 1, 'turn_number', 1), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000023', 'game_id', gid,
    'player_slot', 2, 'event_type', 'score-primary', 'value_number', 4), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000024', 'game_id', gid,
    'player_slot', 1, 'event_type', 'cp-gained', 'value_number', 1), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000025', 'game_id', gid,
    'player_slot', 1, 'event_type', 'cp-spent', 'value_number', 4), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000026', 'game_id', gid,
    'player_slot', 2, 'event_type', 'cp-gained', 'value_number', 3), 1, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000027', 'game_id', gid,
    'player_slot', 2, 'event_type', 'cp-spent', 'value_number', 1), 1, 0);
  hud := public.mt_match_hud(gid);
  assert (hud->'scores'->>'1')::numeric = 5, 'primary unter 0 fällt weg ' || hud->'scores';
  assert (hud->'players'->0->>'primary')::numeric = 0, 'kategorie geclampft';
  assert (hud->'players'->0->>'secondary')::numeric = 5, 'secondary';
  assert (hud->'scores'->>'2')::numeric = 4, 'spieler 2';
  assert (hud->'cp'->>'1')::numeric = 0, 'cp boden 0';
  assert (hud->'players'->0->>'cp_gained')::numeric = 1 and (hud->'players'->0->>'cp_spent')::numeric = 4, 'cp roh';
  assert (hud->'cp'->>'2')::numeric = 2, 'cp spieler 2';

  perform public.mt_revoke_event(gid, '7e570000-0000-4000-8000-000000000022', 1);
  hud := public.mt_match_hud(gid);
  assert (hud->'scores'->>'1')::numeric = 0, 'zurückgenommene Punkte zählen nicht ' || hud->'scores';

  -- Zug: gleicher Zeitstempel Start dann Pause -> nicht laufend, aber aktiver Zug
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000031', 'game_id', gid,
    'player_slot', 2, 'event_type', 'round-start', 'round_number', 1, 'occurred_at', '2026-11-04T10:05:00Z'), 3, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000032', 'game_id', gid,
    'player_slot', 2, 'event_type', 'turn-start', 'round_number', 1, 'turn_number', 1,
    'occurred_at', '2026-11-04T10:05:01Z'), 4, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000033', 'game_id', gid,
    'player_slot', 2, 'event_type', 'turn-pause', 'round_number', 1, 'turn_number', 1,
    'occurred_at', '2026-11-04T10:05:01Z'), 5, 0);
  hud := public.mt_match_hud(gid);
  assert hud->>'phase' = 'turn' and (hud->>'round')::int = 1, 'zugphase ' || hud;
  assert (hud->'active_turn'->>'player_slot')::int = 2
     and (hud->'active_turn'->>'round')::int = 1
     and (hud->'active_turn'->>'turn')::int = 1, 'aktiver zug ' || hud->'active_turn';
  assert (hud->'active_turn'->>'running')::boolean = false, 'pause nach start beim gleichen stempel';

  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000034', 'game_id', gid,
    'player_slot', 2, 'event_type', 'turn-resume', 'round_number', 1, 'turn_number', 1,
    'occurred_at', '2026-11-04T10:06:00Z'), 6, 0);
  hud := public.mt_match_hud(gid);
  assert (hud->'active_turn'->>'running')::boolean, 'timer läuft ' || hud->'active_turn';

  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000035', 'game_id', gid,
    'player_slot', 1, 'event_type', 'setup-pause', 'occurred_at', '2026-11-04T10:07:00Z'), 7, 0);
  hud := public.mt_match_hud(gid);
  assert hud->>'phase' = 'setup' and hud->'active_turn' = 'null'::jsonb, 'zurück in die aufstellung ' || hud;

  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000036', 'game_id', gid,
    'player_slot', 2, 'event_type', 'turn-resume', 'round_number', 1, 'turn_number', 1,
    'occurred_at', '2026-11-04T10:08:00Z'), 8, 0);
  perform public.mt_put_event(jsonb_build_object('id', '7e570000-0000-4000-8000-000000000037', 'game_id', gid,
    'player_slot', 1, 'event_type', 'game-end', 'occurred_at', '2026-11-04T10:09:00Z'), 9, 0);
  hud := public.mt_match_hud(gid);
  assert hud->>'phase' = 'ended' and hud->>'status' = 'completed', 'ende ' || hud;
  assert (hud->'active_turn'->>'running')::boolean = false, 'beendet läuft nicht';
  assert (hud->'active_turn'->>'player_slot')::int = 2, 'letzter zug bleibt sichtbar';

  hud := public.mt_match_hud('7e570000-0000-4000-8000-0000000000ff');
  assert (hud->>'found')::boolean = false and (hud->>'deleted')::boolean = false, 'unbekannt';

  perform public.mt_delete_game(gid, null);
  hud := public.mt_match_hud(gid);
  assert (hud->>'found')::boolean = false and (hud->>'deleted')::boolean, 'gelöscht';

  -- anon darf die internen Helfer nicht rufen
  begin
    perform public.mt_hud_is_running('{}'::jsonb);
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'hud-helfer nicht für anon';

  raise notice 'ONLINE-MATCH SQL OK';
end $$;
rollback;
