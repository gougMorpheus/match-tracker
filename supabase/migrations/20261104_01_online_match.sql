-- 2026-11-04: Online-Spiele + lesender HUD-Snapshot für die Gelände-Layout-App (Forge).
-- Additiv. Alte App (Schema 2) speichert weiter: is_online fehlt im JSON -> Spalte bleibt (Default false).
-- APP_SCHEMA_VERSION dieser Soft-App ist 3. mt_schema_info().min_app_schema bleibt 2, bis der Stand live ist.
-- Rollback: 20261104_01_online_match.rollback.sql
--
-- Vertrag (Lathe ↔ Forge)
-- - match_id = public.games.id (uuid). Kein neues Projekt, keine neuen Keys.
-- - games.is_online boolean not null default false.
--   true: dieses Spiel darf von Gelände als HUD-Quelle gelesen werden.
--   false (Default, auch alle bestehenden Zeilen): normales Spiel, Gelände ignoriert es.
-- - Deep-Link, den Forge konsumiert: Query ?match=<games.id>. Host der Gelände-App steht hier nicht.
-- - Lesen: public.mt_match_hud(p_match_id uuid) -> jsonb. SECURITY DEFINER, nur SELECT, kein Schreiben.
--   Aufruf: POST /rest/v1/rpc/mt_match_hud  { "p_match_id": "<games.id>" }
--   Punkte und CP ändern games.version / flow_version nicht. Forge pollt die RPC (oder hört auf events),
--   nicht nur die Versionszähler.
--
-- HUD-Felder (gleicher Stand wie die App, src/utils/matchHud.ts):
--   found, deleted, match_id, is_online, status (active|completed),
--   phase: setup | turn | ended | pending
--     setup  = Aufstellung aktiv (isSetupActive), round = 0, active_turn = null
--     turn   = getActiveTurn, round = dessen Runde
--     ended  = game-end oder games.ended_at, active_turn = letzter Zug
--     pending = noch keine Aufstellung und kein Zug
--   round, active_turn: { player_slot: 1|2, round, turn, running }
--     running = Timer zählt in diesem Zug (genau ein aktiver Zug, Regel Tim 22.10.)
--   active_player_slot: in der Aufstellung Startspieler, sonst Defender, sonst 1;
--     im Zug der Spieler des aktiven Zugs
--   score_detail: full | total-only | none (aus games.notes.scoreMeta)
--   scores."1"|scores."2" = getPlayerTotalScore
--     full/none: greatest(primary,0)+greatest(secondary,0)+greatest(challenge,0)
--     total-only: Summe score-total, sonst legacyScoreTotals["<id>:player-N"], jeweils >= 0
--   cp."1"|cp."2" = getPlayerCommandPoints = greatest(cp-gained - cp-spent, 0)
--   players[]: slot, name, score, primary, secondary, challenge, cp, cp_gained, cp_spent
--   version, flow_version, as_of
-- Zurückgenommene Ereignisse (revoked_by) zählen nicht. Gelände schreibt nicht nach Match-Tracker.
begin;

alter table public.games add column if not exists is_online boolean not null default false;

create or replace function public.mt_schema_info() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 3, 'min_app_schema', 2, 'server_now', now())
$$;

-- Spiel anlegen oder Zeile ändern. is_online ist optional: fehlt der Schlüssel, bleibt der Stand
-- (beim Anlegen false). Alte Clients ohne das Feld ändern die Spalte nicht.
create or replace function public.mt_save_game(p_game jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.games;
  n public.games;
  cols text[] := array['started_at','ended_at','game_date','player1_name','player1_army','player1_max_points',
    'player2_name','player2_army','player2_max_points','deployment','primary_mission','defender_player',
    'starting_player','winner_player','stats_eligibility_mode','stats_eligibility_overrides','timer_corrections',
    'notes','is_online'];
  merged jsonb;
begin
  if p_game is null or (p_game->>'id') is null then
    raise exception using errcode = '22023', message = 'mt_save_game: id fehlt';
  end if;
  select * into g from public.games where id = (p_game->>'id')::uuid for update;
  if not found then
    n := jsonb_populate_record(null::public.games,
      (select jsonb_object_agg(k, p_game->k) from unnest(cols || array['id','created_at']) k where p_game ? k));
    insert into public.games (id, created_at, started_at, ended_at, game_date, player1_name, player1_army, player1_max_points,
      player2_name, player2_army, player2_max_points, deployment, primary_mission, defender_player, starting_player,
      winner_player, stats_eligibility_mode, stats_eligibility_overrides, timer_corrections, notes, is_online, version, flow_version)
    values (n.id, coalesce(n.created_at, now()), coalesce(n.started_at, now()), n.ended_at, n.game_date, n.player1_name,
      n.player1_army, n.player1_max_points, n.player2_name, n.player2_army, n.player2_max_points, n.deployment,
      n.primary_mission, n.defender_player, n.starting_player, n.winner_player, n.stats_eligibility_mode,
      n.stats_eligibility_overrides, n.timer_corrections, n.notes, coalesce(n.is_online, false), 1, 1)
    returning * into g;
    return jsonb_build_object('matched', true, 'version', g.version, 'flow_version', g.flow_version, 'created', true);
  end if;
  if g.deleted_at is not null then
    perform public.mt_conflict('deleted', g.id, p_expected_version, g.version);
  end if;
  merged := to_jsonb(g) || (select coalesce(jsonb_object_agg(k, p_game->k), '{}'::jsonb) from unnest(cols) k where p_game ? k);
  n := jsonb_populate_record(null::public.games, merged);
  n.is_online := coalesce(n.is_online, g.is_online, false);
  if (select bool_and(to_jsonb(g)->k is not distinct from to_jsonb(n)->k) from unnest(cols) k) then
    return jsonb_build_object('matched', p_expected_version is not distinct from g.version,
      'version', g.version, 'flow_version', g.flow_version, 'noop', true);
  end if;
  if p_expected_version is distinct from g.version then
    perform public.mt_conflict('game', g.id, p_expected_version, g.version);
  end if;
  update public.games set started_at = n.started_at, ended_at = n.ended_at, game_date = n.game_date,
    player1_name = n.player1_name, player1_army = n.player1_army, player1_max_points = n.player1_max_points,
    player2_name = n.player2_name, player2_army = n.player2_army, player2_max_points = n.player2_max_points,
    deployment = n.deployment, primary_mission = n.primary_mission, defender_player = n.defender_player,
    starting_player = n.starting_player, winner_player = n.winner_player,
    stats_eligibility_mode = n.stats_eligibility_mode, stats_eligibility_overrides = n.stats_eligibility_overrides,
    timer_corrections = n.timer_corrections, notes = n.notes, is_online = n.is_online, version = g.version + 1
  where id = g.id returning * into g;
  return jsonb_build_object('matched', true, 'version', g.version, 'flow_version', g.flow_version);
end $$;

-- Hilfen nur für mt_match_hud. Nicht für anon/authenticated.
create or replace function public.mt_hud_is_start_for(start_ev jsonb, pause_ev jsonb) returns boolean
language sql immutable set search_path = public as $$
  select case
    when pause_ev->>'action' = 'setup-pause' then start_ev->>'action' in ('game-start', 'setup-start')
    else start_ev->>'action' = 'game-start'
      or (start_ev->>'action' = 'round-start' and ((start_ev->>'round') is null or (start_ev->>'round') = (pause_ev->>'round')))
      or (start_ev->>'action' = 'turn-start'
          and (start_ev->>'round') = (pause_ev->>'round')
          and (start_ev->>'turn') = (pause_ev->>'turn'))
  end
$$;

-- Entfernt Index from_idx und setzt das Element an to_idx der verkürzten Liste (wie splice im App-Code).
create or replace function public.mt_hud_array_move(arr jsonb, from_idx int, to_idx int) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  item jsonb := arr->from_idx;
  moved jsonb := '[]'::jsonb;
  i int;
  n int := jsonb_array_length(arr);
  placed boolean := false;
begin
  if arr is null or n = 0 or from_idx < 0 or from_idx >= n then
    return coalesce(arr, '[]'::jsonb);
  end if;
  for i in 0..(n - 1) loop
    if i = from_idx then
      continue;
    end if;
    if jsonb_array_length(moved) = to_idx and not placed then
      moved := moved || jsonb_build_array(item);
      placed := true;
    end if;
    moved := moved || jsonb_build_array(arr->i);
  end loop;
  if not placed then
    moved := moved || jsonb_build_array(item);
  end if;
  return moved;
end $$;

-- Gleicher Zeitstempel: Pause hinter den passenden Start (timeEventOrder.fixStartBeforePauseTies).
-- Eingabe muss schon nach "at" sortiert sein.
create or replace function public.mt_hud_fix_pause_order(events jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  n int;
  i int := 0;
  j int;
  k int;
  m int;
  last_idx int;
  grp jsonb;
  result jsonb := '[]'::jsonb;
  ev jsonb;
  at text;
begin
  if events is null or jsonb_typeof(events) <> 'array' then
    return '[]'::jsonb;
  end if;
  n := jsonb_array_length(events);
  while i < n loop
    at := events->i->>'at';
    j := i + 1;
    while j < n and (events->j->>'at') is not distinct from at loop
      j := j + 1;
    end loop;
    grp := '[]'::jsonb;
    for k in i..(j - 1) loop
      grp := grp || jsonb_build_array(events->k);
    end loop;
    if j - i > 1 then
      k := 0;
      while k < jsonb_array_length(grp) loop
        ev := grp->k;
        if ev->>'action' in ('turn-pause', 'setup-pause') then
          last_idx := -1;
          if k + 1 <= jsonb_array_length(grp) - 1 then
            for m in (k + 1)..(jsonb_array_length(grp) - 1) loop
              if public.mt_hud_is_start_for(grp->m, ev) then
                last_idx := m;
              end if;
            end loop;
          end if;
          if last_idx > k then
            grp := public.mt_hud_array_move(grp, k, last_idx);
            k := k - 1;
          end if;
        end if;
        k := k + 1;
      end loop;
    end if;
    result := result || grp;
    i := j;
  end loop;
  return result;
end $$;

create or replace function public.mt_hud_is_running(t jsonb) returns boolean
language sql immutable set search_path = public as $$
  select t->>'started_at' is not null
    and t->>'ended_at' is null
    and (
      coalesce(jsonb_array_length(t->'pauses'), 0) = 0
      or (t->'pauses'->(jsonb_array_length(t->'pauses') - 1)->>'ended_at') is not null
    )
$$;

create or replace function public.mt_hud_stop_others(state jsonb, at text, except_key text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  keys text[];
  k text;
  t jsonb;
  pauses jsonb;
  n int;
  last_pause jsonb;
begin
  select coalesce(array_agg(ok), '{}') into keys from jsonb_object_keys(coalesce(state->'turns', '{}'::jsonb)) as ok;
  foreach k in array keys loop
    if except_key is not null and k = except_key then
      continue;
    end if;
    t := state->'turns'->k;
    pauses := coalesce(t->'pauses', '[]'::jsonb);
    n := jsonb_array_length(pauses);
    last_pause := case when n > 0 then pauses->(n - 1) else null end;
    if coalesce((t->>'reopened')::boolean, false) then
      t := jsonb_set(t, '{reopened}', 'false'::jsonb);
      if last_pause is not null and last_pause->>'ended_at' is null then
        t := jsonb_set(t, '{ended_at}', to_jsonb(last_pause->>'started_at'));
        t := jsonb_set(t, '{pauses}', pauses - (n - 1));
      else
        t := jsonb_set(t, '{ended_at}', to_jsonb(at));
      end if;
    elsif public.mt_hud_is_running(t) then
      t := jsonb_set(t, '{pauses}', pauses || jsonb_build_array(jsonb_build_object('started_at', at)));
    else
      continue;
    end if;
    state := jsonb_set(state, array['turns', k], t);
  end loop;
  return state;
end $$;

create or replace function public.mt_hud_apply_event(state jsonb, ev jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  action text := ev->>'action';
  at text := ev->>'at';
  key text;
  t jsonb;
  pauses jsonb;
  last_pause jsonb;
  n int;
begin
  if action in ('setup-start', 'setup-resume') then
    return public.mt_hud_stop_others(state, at, null);
  end if;
  if action not in ('turn-start', 'turn-resume', 'turn-pause', 'turn-end')
     or ev->>'round' is null or ev->>'turn' is null or ev->>'slot' is null then
    return state;
  end if;
  key := (ev->>'round') || ':' || (ev->>'turn');
  t := coalesce(state->'turns'->key, jsonb_build_object(
    'round', (ev->>'round')::int,
    'turn', (ev->>'turn')::int,
    'slot', (ev->>'slot')::int,
    'started_at', null,
    'ended_at', null,
    'pauses', '[]'::jsonb,
    'reopened', false
  ));
  t := jsonb_set(t, '{slot}', to_jsonb((ev->>'slot')::int));
  t := jsonb_set(t, '{round}', to_jsonb((ev->>'round')::int));
  t := jsonb_set(t, '{turn}', to_jsonb((ev->>'turn')::int));
  pauses := coalesce(t->'pauses', '[]'::jsonb);
  n := jsonb_array_length(pauses);
  last_pause := case when n > 0 then pauses->(n - 1) else null end;

  if action = 'turn-start' then
    if t->>'ended_at' is not null and (at::timestamptz) >= ((t->>'ended_at')::timestamptz) then
      return jsonb_set(state, array['turns', key], t);
    end if;
    if t->>'started_at' is null then
      t := jsonb_set(t, '{started_at}', to_jsonb(at));
    elsif last_pause is not null and last_pause->>'ended_at' is null then
      pauses := jsonb_set(pauses, array[(n - 1)::text, 'ended_at'], to_jsonb(at));
      t := jsonb_set(t, '{pauses}', pauses);
    end if;
    state := jsonb_set(state, array['turns', key], t);
    return public.mt_hud_stop_others(state, at, key);
  end if;

  if action = 'turn-resume' then
    if t->>'started_at' is null then
      return jsonb_set(state, array['turns', key], t);
    end if;
    if t->>'ended_at' is not null and (at::timestamptz) >= ((t->>'ended_at')::timestamptz) then
      pauses := pauses || jsonb_build_array(jsonb_build_object('started_at', t->>'ended_at', 'ended_at', at));
      t := jsonb_set(t, '{pauses}', pauses);
      t := jsonb_set(t, '{ended_at}', 'null'::jsonb);
      t := jsonb_set(t, '{reopened}', 'true'::jsonb);
    elsif last_pause is not null and last_pause->>'ended_at' is null
          and (at::timestamptz) >= ((last_pause->>'started_at')::timestamptz) then
      pauses := jsonb_set(pauses, array[(n - 1)::text, 'ended_at'], to_jsonb(at));
      t := jsonb_set(t, '{pauses}', pauses);
    end if;
    state := jsonb_set(state, array['turns', key], t);
    return public.mt_hud_stop_others(state, at, key);
  end if;

  if action = 'turn-pause' then
    if t->>'started_at' is null
       or (t->>'ended_at' is not null and (at::timestamptz) >= ((t->>'ended_at')::timestamptz)) then
      return jsonb_set(state, array['turns', key], t);
    end if;
    if n = 0 or last_pause->>'ended_at' is not null then
      pauses := pauses || jsonb_build_array(jsonb_build_object('started_at', at));
      t := jsonb_set(t, '{pauses}', pauses);
    end if;
    return jsonb_set(state, array['turns', key], t);
  end if;

  -- turn-end
  if t->>'ended_at' is not null and (at::timestamptz) >= ((t->>'ended_at')::timestamptz) then
    return jsonb_set(state, array['turns', key], t);
  end if;
  if last_pause is not null and last_pause->>'ended_at' is null then
    pauses := jsonb_set(pauses, array[(n - 1)::text, 'ended_at'], to_jsonb(at));
    t := jsonb_set(t, '{pauses}', pauses);
  end if;
  t := jsonb_set(t, '{ended_at}', to_jsonb(at));
  t := jsonb_set(t, '{reopened}', 'false'::jsonb);
  return jsonb_set(state, array['turns', key], t);
end $$;

create or replace function public.mt_hud_close_open(state jsonb, at text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  keys text[];
  k text;
  t jsonb;
  pauses jsonb;
  n int;
  last_pause jsonb;
begin
  select coalesce(array_agg(ok), '{}') into keys from jsonb_object_keys(coalesce(state->'turns', '{}'::jsonb)) as ok;
  foreach k in array keys loop
    t := state->'turns'->k;
    if t->>'started_at' is null or t->>'ended_at' is not null then
      continue;
    end if;
    pauses := coalesce(t->'pauses', '[]'::jsonb);
    n := jsonb_array_length(pauses);
    last_pause := case when n > 0 then pauses->(n - 1) else null end;
    if last_pause is not null and last_pause->>'ended_at' is null then
      pauses := jsonb_set(pauses, array[(n - 1)::text, 'ended_at'], to_jsonb(at));
      t := jsonb_set(t, '{pauses}', pauses);
    end if;
    t := jsonb_set(t, '{ended_at}', to_jsonb(at));
    state := jsonb_set(state, array['turns', k], t);
  end loop;
  return state;
end $$;

create or replace function public.mt_hud_pick_active(state jsonb, select_events jsonb, completed boolean) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  turns jsonb := '[]'::jsonb;
  i int;
  n int;
  t jsonb;
  best jsonb;
  best_at text;
  pause_at text;
  marked jsonb;
  last_ev jsonb;
  pauses jsonb;
  pn int;
begin
  select coalesce(jsonb_agg(value order by (value->>'round')::int, (value->>'turn')::int), '[]'::jsonb)
    into turns
  from jsonb_each(coalesce(state->'turns', '{}'::jsonb));
  n := jsonb_array_length(turns);
  for i in 0..(n - 1) loop
    if public.mt_hud_is_running(turns->i) then
      return turns->i;
    end if;
  end loop;
  if not completed and select_events is not null and jsonb_array_length(select_events) > 0 then
    last_ev := select_events->(jsonb_array_length(select_events) - 1);
    for i in 0..(n - 1) loop
      t := turns->i;
      if (t->>'round') = (last_ev->>'round') and (t->>'turn') = (last_ev->>'turn') and t->>'started_at' is not null then
        return t;
      end if;
    end loop;
  end if;
  best := null;
  best_at := null;
  for i in 0..(n - 1) loop
    t := turns->i;
    if t->>'started_at' is null or t->>'ended_at' is not null then
      continue;
    end if;
    pauses := coalesce(t->'pauses', '[]'::jsonb);
    pn := jsonb_array_length(pauses);
    pause_at := case when pn > 0 then pauses->(pn - 1)->>'started_at' else '' end;
    if best is null or pause_at > best_at then
      best := t;
      best_at := pause_at;
    end if;
  end loop;
  if best is not null then
    return best;
  end if;
  if n = 0 then
    return null;
  end if;
  return turns->(n - 1);
end $$;

create or replace function public.mt_match_hud(p_match_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g public.games;
  notes jsonb := '{}'::jsonb;
  detail text := 'full';
  raw jsonb;
  ordered jsonb;
  subset jsonb;
  setup_events jsonb;
  ev jsonb;
  state jsonb := '{"turns":{}}'::jsonb;
  game_end_at timestamptz;
  completed boolean;
  active jsonb;
  phase text;
  round_no int;
  active_slot int;
  running boolean;
  has_legacy boolean;
  p1_primary numeric; p1_secondary numeric; p1_challenge numeric; p1_total numeric; p1_gained numeric; p1_spent numeric;
  p2_primary numeric; p2_secondary numeric; p2_challenge numeric; p2_total numeric; p2_gained numeric; p2_spent numeric;
  s1 numeric; s2 numeric; c1 numeric; c2 numeric;
  as_of timestamptz;
  i int;
  setup_latest text;
begin
  if p_match_id is null then
    return jsonb_build_object('found', false, 'match_id', null, 'deleted', false);
  end if;
  select * into g from public.games where id = p_match_id;
  if not found then
    return jsonb_build_object('found', false, 'match_id', p_match_id, 'deleted', false);
  end if;
  if g.deleted_at is not null then
    return jsonb_build_object('found', false, 'match_id', p_match_id, 'deleted', true);
  end if;

  begin
    notes := coalesce(nullif(g.notes, ''), '{}')::jsonb;
  exception when others then
    notes := '{}'::jsonb;
  end;
  if jsonb_typeof(notes) is distinct from 'object' then
    notes := '{}'::jsonb;
  end if;
  detail := coalesce(notes #>> '{scoreMeta,scoreDetailLevel}', 'full');
  if detail not in ('full', 'total-only', 'none') then
    detail := 'full';
  end if;

  select
    coalesce(sum(value_number) filter (where player_slot = 1 and event_type = 'score-primary'), 0),
    coalesce(sum(value_number) filter (where player_slot = 1 and event_type = 'score-secondary'), 0),
    coalesce(sum(value_number) filter (where player_slot = 1 and event_type = 'score-challenge'), 0),
    coalesce(sum(value_number) filter (where player_slot = 1 and event_type = 'score-total'), 0),
    coalesce(sum(value_number) filter (where player_slot = 1 and event_type = 'cp-gained'), 0),
    coalesce(sum(value_number) filter (where player_slot = 1 and event_type = 'cp-spent'), 0),
    coalesce(sum(value_number) filter (where player_slot = 2 and event_type = 'score-primary'), 0),
    coalesce(sum(value_number) filter (where player_slot = 2 and event_type = 'score-secondary'), 0),
    coalesce(sum(value_number) filter (where player_slot = 2 and event_type = 'score-challenge'), 0),
    coalesce(sum(value_number) filter (where player_slot = 2 and event_type = 'score-total'), 0),
    coalesce(sum(value_number) filter (where player_slot = 2 and event_type = 'cp-gained'), 0),
    coalesce(sum(value_number) filter (where player_slot = 2 and event_type = 'cp-spent'), 0)
  into p1_primary, p1_secondary, p1_challenge, p1_total, p1_gained, p1_spent,
       p2_primary, p2_secondary, p2_challenge, p2_total, p2_gained, p2_spent
  from public.events
  where game_id = g.id and revoked_by is null;

  has_legacy := exists (
    select 1 from public.events
    where game_id = g.id and revoked_by is null and event_type = 'score-total'
  );
  if detail = 'total-only' then
    if has_legacy then
      s1 := greatest(p1_total, 0);
      s2 := greatest(p2_total, 0);
    else
      s1 := greatest(coalesce((notes #>> array['scoreMeta','legacyScoreTotals', g.id::text || ':player-1'])::numeric, 0), 0);
      s2 := greatest(coalesce((notes #>> array['scoreMeta','legacyScoreTotals', g.id::text || ':player-2'])::numeric, 0), 0);
    end if;
    p1_primary := 0; p1_secondary := 0; p1_challenge := 0;
    p2_primary := 0; p2_secondary := 0; p2_challenge := 0;
  else
    p1_primary := greatest(p1_primary, 0);
    p1_secondary := greatest(p1_secondary, 0);
    p1_challenge := greatest(p1_challenge, 0);
    p2_primary := greatest(p2_primary, 0);
    p2_secondary := greatest(p2_secondary, 0);
    p2_challenge := greatest(p2_challenge, 0);
    s1 := p1_primary + p1_secondary + p1_challenge;
    s2 := p2_primary + p2_secondary + p2_challenge;
  end if;
  c1 := greatest(p1_gained - p1_spent, 0);
  c2 := greatest(p2_gained - p2_spent, 0);

  select coalesce(jsonb_agg(jsonb_build_object(
      'action', event_type,
      'at', to_jsonb(occurred_at) #>> '{}',
      'round', round_number,
      'turn', turn_number,
      'slot', player_slot
    ) order by occurred_at, created_at, id), '[]'::jsonb)
    into raw
  from public.events
  where game_id = g.id
    and revoked_by is null
    and event_type in (
      'game-start','game-end','setup-start','setup-end','setup-pause','setup-resume',
      'round-start','round-end','turn-start','turn-end','turn-pause','turn-resume',
      'timeout-start','timeout-end'
    );

  select min(occurred_at) into game_end_at
  from public.events
  where game_id = g.id and revoked_by is null and event_type = 'game-end';
  if game_end_at is null then
    game_end_at := g.ended_at;
  end if;
  completed := game_end_at is not null;

  ordered := public.mt_hud_fix_pause_order(raw);
  for i in 0..(jsonb_array_length(ordered) - 1) loop
    ev := ordered->i;
    if game_end_at is not null and ev->>'action' <> 'game-end' and (ev->>'at')::timestamptz > game_end_at then
      continue;
    end if;
    state := public.mt_hud_apply_event(state, ev);
  end loop;
  if game_end_at is not null then
    state := public.mt_hud_close_open(state, to_jsonb(game_end_at) #>> '{}');
  end if;

  subset := '[]'::jsonb;
  setup_events := '[]'::jsonb;
  if not completed then
    for i in 0..(jsonb_array_length(raw) - 1) loop
      ev := raw->i;
      if ev->>'action' in ('turn-start', 'turn-resume', 'turn-pause')
         and ev->>'round' is not null and ev->>'turn' is not null then
        subset := subset || jsonb_build_array(ev);
      end if;
      if ev->>'action' in ('setup-start', 'setup-end', 'setup-pause', 'setup-resume', 'turn-start', 'turn-resume') then
        setup_events := setup_events || jsonb_build_array(ev);
      end if;
    end loop;
    subset := public.mt_hud_fix_pause_order(subset);
    setup_events := public.mt_hud_fix_pause_order(setup_events);
  end if;

  active := public.mt_hud_pick_active(state, subset, completed);
  setup_latest := case
    when setup_events is not null and jsonb_array_length(setup_events) > 0
      then setup_events->(jsonb_array_length(setup_events) - 1)->>'action'
    else null
  end;

  if completed then
    phase := 'ended';
  elsif setup_latest is not null and setup_latest not in ('setup-end', 'turn-start', 'turn-resume') then
    phase := 'setup';
    active := null;
  elsif active is not null then
    phase := 'turn';
  else
    phase := 'pending';
  end if;

  if phase in ('setup', 'pending') then
    round_no := 0;
  elsif active is not null then
    round_no := (active->>'round')::int;
  else
    round_no := 0;
  end if;

  running := phase = 'turn' and active is not null and public.mt_hud_is_running(active);
  if active is not null and phase in ('turn', 'ended') then
    active_slot := (active->>'slot')::int;
  else
    active_slot := coalesce(g.starting_player, g.defender_player, 1);
  end if;

  select max(ts) into as_of from (
    select g.created_at as ts
    union all select g.started_at
    union all select g.ended_at
    union all select max(occurred_at) from public.events where game_id = g.id and revoked_by is null
  ) stamps;

  return jsonb_build_object(
    'found', true,
    'deleted', false,
    'match_id', g.id,
    'is_online', g.is_online,
    'status', case when completed then 'completed' else 'active' end,
    'phase', phase,
    'round', round_no,
    'active_turn', case when active is null or phase in ('setup', 'pending') then null else jsonb_build_object(
      'player_slot', (active->>'slot')::int,
      'round', (active->>'round')::int,
      'turn', (active->>'turn')::int,
      'running', running
    ) end,
    'active_player_slot', active_slot,
    'score_detail', detail,
    'scores', jsonb_build_object('1', s1, '2', s2),
    'cp', jsonb_build_object('1', c1, '2', c2),
    'players', jsonb_build_array(
      jsonb_build_object(
        'slot', 1, 'name', g.player1_name, 'score', s1,
        'primary', p1_primary, 'secondary', p1_secondary, 'challenge', p1_challenge,
        'cp', c1, 'cp_gained', p1_gained, 'cp_spent', p1_spent
      ),
      jsonb_build_object(
        'slot', 2, 'name', g.player2_name, 'score', s2,
        'primary', p2_primary, 'secondary', p2_secondary, 'challenge', p2_challenge,
        'cp', c2, 'cp_gained', p2_gained, 'cp_spent', p2_spent
      )
    ),
    'version', g.version,
    'flow_version', g.flow_version,
    'as_of', as_of
  );
end $$;

comment on function public.mt_match_hud(uuid) is
  'Read-only HUD for Gelände. p_match_id = games.id. Round, active turn, scores, CP. No writes.';

revoke all on function public.mt_save_game(jsonb, bigint) from public;
grant execute on function public.mt_save_game(jsonb, bigint) to anon, authenticated;
grant execute on function public.mt_schema_info() to anon, authenticated;

revoke all on function public.mt_hud_is_start_for(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mt_hud_array_move(jsonb, int, int) from public, anon, authenticated;
revoke all on function public.mt_hud_fix_pause_order(jsonb) from public, anon, authenticated;
revoke all on function public.mt_hud_is_running(jsonb) from public, anon, authenticated;
revoke all on function public.mt_hud_stop_others(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.mt_hud_apply_event(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mt_hud_close_open(jsonb, text) from public, anon, authenticated;
revoke all on function public.mt_hud_pick_active(jsonb, jsonb, boolean) from public, anon, authenticated;

revoke all on function public.mt_match_hud(uuid) from public;
grant execute on function public.mt_match_hud(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
