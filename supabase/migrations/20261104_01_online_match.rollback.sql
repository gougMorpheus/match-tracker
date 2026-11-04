-- Rollback zu 20261104_01_online_match.sql.
-- Stellt mt_save_game und mt_schema_info auf den Stand von 20261012_01 (schema_version 2, min_app_schema 2).
-- Erst die Funktionen, dann die Spalte: mt_save_game darf is_online danach nicht mehr nennen.
begin;

drop function if exists public.mt_match_hud(uuid);
drop function if exists public.mt_hud_pick_active(jsonb, jsonb, boolean);
drop function if exists public.mt_hud_close_open(jsonb, text);
drop function if exists public.mt_hud_apply_event(jsonb, jsonb);
drop function if exists public.mt_hud_stop_others(jsonb, text, text);
drop function if exists public.mt_hud_is_running(jsonb);
drop function if exists public.mt_hud_fix_pause_order(jsonb);
drop function if exists public.mt_hud_array_move(jsonb, int, int);
drop function if exists public.mt_hud_is_start_for(jsonb, jsonb);

create or replace function public.mt_schema_info() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 2, 'min_app_schema', 2, 'server_now', now())
$$;

create or replace function public.mt_save_game(p_game jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.games;
  n public.games;
  cols text[] := array['started_at','ended_at','game_date','player1_name','player1_army','player1_max_points',
    'player2_name','player2_army','player2_max_points','deployment','primary_mission','defender_player',
    'starting_player','winner_player','stats_eligibility_mode','stats_eligibility_overrides','timer_corrections','notes'];
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
      winner_player, stats_eligibility_mode, stats_eligibility_overrides, timer_corrections, notes, version, flow_version)
    values (n.id, coalesce(n.created_at, now()), coalesce(n.started_at, now()), n.ended_at, n.game_date, n.player1_name,
      n.player1_army, n.player1_max_points, n.player2_name, n.player2_army, n.player2_max_points, n.deployment,
      n.primary_mission, n.defender_player, n.starting_player, n.winner_player, n.stats_eligibility_mode,
      n.stats_eligibility_overrides, n.timer_corrections, n.notes, 1, 1)
    returning * into g;
    return jsonb_build_object('matched', true, 'version', g.version, 'flow_version', g.flow_version, 'created', true);
  end if;
  if g.deleted_at is not null then
    perform public.mt_conflict('deleted', g.id, p_expected_version, g.version);
  end if;
  merged := to_jsonb(g) || (select coalesce(jsonb_object_agg(k, p_game->k), '{}'::jsonb) from unnest(cols) k where p_game ? k);
  n := jsonb_populate_record(null::public.games, merged);
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
    timer_corrections = n.timer_corrections, notes = n.notes, version = g.version + 1
  where id = g.id returning * into g;
  return jsonb_build_object('matched', true, 'version', g.version, 'flow_version', g.flow_version);
end $$;

alter table public.games drop column if exists is_online;

notify pgrst, 'reload schema';
commit;
