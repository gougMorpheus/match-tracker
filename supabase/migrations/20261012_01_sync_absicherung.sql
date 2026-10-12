-- Sync-Absicherung Phase 1 (additiv): Versionen, Serverzeit-RPCs, Gegenereignisse, Unique-Index.
-- Alte App-Versionen schreiben in dieser Phase weiter direkt (Policies unveraendert).
-- Rollback: 20261012_01_sync_absicherung.rollback.sql (erst NACH Rollback von Phase 2 und der App).
begin;

-- Versionen: version = games-Zeile (Metadaten, Ende, Timer-Korrekturen),
-- flow_version = Spielablauf (Zugwechsel, Timer, Spielende, Rücknahmen davon).
alter table public.games add column if not exists version bigint not null default 1;
alter table public.games add column if not exists flow_version bigint not null default 1;

-- Gegenereignisse: Ziel wird ueber revoked_by markiert, das Gegenereignis selbst bleibt als Audit.
-- legacy: alle Zeilen vor der Migration (dort gibt es echte Dubletten, die bleiben unangetastet).
alter table public.events add column if not exists revoked_by uuid null;
alter table public.events add column if not exists legacy boolean not null default true;
alter table public.events alter column legacy set default false;

create index if not exists idx_events_revoked_by on public.events (revoked_by) where revoked_by is not null;

-- Zugwechsel genau einmal je Runde/Zug (nur neue, nicht zurueckgenommene Ereignisse).
create unique index if not exists events_flow_unique
  on public.events (game_id, round_number, turn_number, event_type)
  where not legacy and revoked_by is null and event_type in ('turn-start', 'round-start');

-- Zurueckgenommene Ereignisse und Audit-Zeilen sind fuer Clients unsichtbar (auch fuer alte App-Versionen).
drop policy if exists "events_select_all" on public.events;
create policy "events_select_all" on public.events for select
  using (revoked_by is null and event_type not in ('revoke', 'restore'));

create or replace function public.mt_is_flow_event(p_type text) returns boolean
language sql immutable set search_path = public as $$
  select p_type in ('game-start','game-end','setup-start','setup-end','setup-pause','setup-resume',
    'round-start','round-end','turn-start','turn-end','turn-pause','turn-resume','timeout-start','timeout-end')
$$;

create or replace function public.mt_conflict(p_kind text, p_game uuid, p_expected bigint, p_current bigint)
returns void language plpgsql set search_path = public as $$
begin
  raise exception using errcode = 'PT409', message = 'mt_conflict',
    detail = json_build_object('kind', p_kind, 'game_id', p_game, 'expected', p_expected, 'current', p_current)::text;
end $$;

create or replace function public.mt_schema_info() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 2, 'min_app_schema', 2, 'server_now', now())
$$;

-- Spiel anlegen oder Zeile aendern (Versionspruefung auf games.version).
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

create or replace function public.mt_delete_game(p_game_id uuid, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  update public.games set deleted_at = coalesce(deleted_at, now()), notes = coalesce(p_notes, notes), version = version + 1
  where id = p_game_id returning * into g;
  return jsonb_build_object('matched', true, 'version', g.version, 'flow_version', g.flow_version);
end $$;

-- Ereignis anlegen/aendern. Ablauf-Ereignisse: Pruefung auf flow_version, Zeit = Serverzeit
-- (now() minus Wartezeit in der Offline-Queue, nie vor dem letzten Ablauf-Ereignis).
create or replace function public.mt_put_event(p_event jsonb, p_expected_flow bigint, p_queued_ms bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.games;
  e public.events;
  cur public.events;
  is_flow boolean;
  ts timestamptz;
  last_ts timestamptz;
  restored boolean := false;
  matched boolean;
begin
  e := jsonb_populate_record(null::public.events, p_event);
  if e.id is null or e.game_id is null or e.event_type is null or e.event_type in ('revoke','restore') then
    raise exception using errcode = '22023', message = 'mt_put_event: ungueltiges Ereignis';
  end if;
  select * into g from public.games where id = e.game_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'mt_game_missing';
  end if;
  if g.deleted_at is not null then
    perform public.mt_conflict('deleted', g.id, p_expected_flow, g.flow_version);
  end if;
  is_flow := public.mt_is_flow_event(e.event_type);
  matched := p_expected_flow is not distinct from g.flow_version;
  select * into cur from public.events where id = e.id for update;
  if found then
    if cur.game_id <> e.game_id then
      raise exception using errcode = '22023', message = 'mt_put_event: falsches Spiel';
    end if;
    if cur.revoked_by is null and cur.event_type = e.event_type
       and cur.round_number is not distinct from e.round_number and cur.turn_number is not distinct from e.turn_number
       and cur.player_slot = e.player_slot and cur.value_number is not distinct from e.value_number
       and cur.note is not distinct from e.note
       and (is_flow or cur.occurred_at is not distinct from coalesce(e.occurred_at, cur.occurred_at)) then
      return jsonb_build_object('matched', matched, 'version', g.version, 'flow_version', g.flow_version, 'noop', true,
        'event', to_jsonb(cur));
    end if;
    if is_flow or public.mt_is_flow_event(cur.event_type) then
      if not matched then perform public.mt_conflict('flow', g.id, p_expected_flow, g.flow_version); end if;
    end if;
    if cur.revoked_by is not null then
      insert into public.events (game_id, round_number, turn_number, player_slot, event_type, note, occurred_at)
      values (cur.game_id, cur.round_number, cur.turn_number, cur.player_slot, 'restore', cur.id::text, now());
      restored := true;
    end if;
    update public.events set revoked_by = null, event_type = e.event_type, round_number = e.round_number,
      turn_number = e.turn_number, player_slot = e.player_slot, value_number = e.value_number, note = e.note,
      occurred_at = case when restored and is_flow then cur.occurred_at else coalesce(e.occurred_at, cur.occurred_at) end
    where id = e.id returning * into cur;
  else
    if is_flow then
      if not matched then perform public.mt_conflict('flow', g.id, p_expected_flow, g.flow_version); end if;
      select max(occurred_at) into last_ts from public.events
        where game_id = g.id and revoked_by is null and public.mt_is_flow_event(event_type);
      ts := now() - make_interval(secs => least(greatest(coalesce(p_queued_ms, 0), 0), 604800000) / 1000.0);
      ts := greatest(ts, coalesce(last_ts, ts));
    else
      ts := coalesce(e.occurred_at, now());
    end if;
    begin
      insert into public.events (id, created_at, game_id, round_number, turn_number, player_slot, event_type,
        value_number, note, occurred_at)
      values (e.id, case when is_flow then ts else coalesce(e.created_at, now()) end, e.game_id, e.round_number,
        e.turn_number, e.player_slot, e.event_type, e.value_number, e.note, ts)
      returning * into cur;
    exception when unique_violation then
      perform public.mt_conflict('flow-unique', g.id, p_expected_flow, g.flow_version);
    end;
  end if;
  if is_flow or restored then
    update public.games set flow_version = flow_version + 1 where id = g.id returning * into g;
    return jsonb_build_object('matched', matched, 'version', g.version, 'flow_version', g.flow_version, 'event', to_jsonb(cur));
  end if;
  return jsonb_build_object('matched', matched, 'version', g.version, 'flow_version', g.flow_version, 'event', to_jsonb(cur));
end $$;

-- Undo/Loeschen als Gegenereignis.
create or replace function public.mt_revoke_event(p_game_id uuid, p_event_id uuid, p_expected_flow bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.games;
  cur public.events;
  rid uuid;
  matched boolean;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('matched', true, 'noop', true);
  end if;
  matched := p_expected_flow is not distinct from g.flow_version;
  select * into cur from public.events where id = p_event_id and game_id = p_game_id for update;
  if not found or cur.revoked_by is not null then
    return jsonb_build_object('matched', matched, 'version', g.version, 'flow_version', g.flow_version, 'noop', true);
  end if;
  if public.mt_is_flow_event(cur.event_type) and not matched then
    perform public.mt_conflict('flow', g.id, p_expected_flow, g.flow_version);
  end if;
  insert into public.events (game_id, round_number, turn_number, player_slot, event_type, note, occurred_at)
  values (cur.game_id, cur.round_number, cur.turn_number, cur.player_slot, 'revoke', cur.id::text, now())
  returning id into rid;
  update public.events set revoked_by = rid where id = cur.id;
  if public.mt_is_flow_event(cur.event_type) then
    update public.games set flow_version = flow_version + 1 where id = g.id returning * into g;
  end if;
  return jsonb_build_object('matched', matched, 'version', g.version, 'flow_version', g.flow_version);
end $$;

revoke all on function public.mt_save_game(jsonb, bigint) from public;
revoke all on function public.mt_delete_game(uuid, text) from public;
revoke all on function public.mt_put_event(jsonb, bigint, bigint) from public;
revoke all on function public.mt_revoke_event(uuid, uuid, bigint) from public;
revoke all on function public.mt_conflict(text, uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.mt_save_game(jsonb, bigint) to anon, authenticated;
grant execute on function public.mt_delete_game(uuid, text) to anon, authenticated;
grant execute on function public.mt_put_event(jsonb, bigint, bigint) to anon, authenticated;
grant execute on function public.mt_revoke_event(uuid, uuid, bigint) to anon, authenticated;
grant execute on function public.mt_schema_info() to anon, authenticated;
grant execute on function public.mt_is_flow_event(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
