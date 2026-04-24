create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  game_date timestamptz null,
  player1_name text not null,
  player1_army text not null,
  player1_max_points integer not null,
  player2_name text not null,
  player2_army text not null,
  player2_max_points integer not null,
  deployment text null,
  primary_mission text null,
  defender_player smallint null check (defender_player in (1, 2)),
  starting_player smallint null check (starting_player in (1, 2)),
  winner_player smallint null check (winner_player in (1, 2)),
  notes text null
);

alter table public.games add column if not exists deployment text null;
alter table public.games add column if not exists primary_mission text null;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  game_id uuid not null references public.games(id) on delete cascade,
  round_number integer null,
  turn_number integer null,
  player_slot smallint not null check (player_slot in (1, 2)),
  event_type text not null,
  value_number numeric null,
  note text null,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_games_created_at_desc on public.games (created_at desc);
create index if not exists idx_events_game_id on public.events (game_id);
create index if not exists idx_events_event_type on public.events (event_type);
create index if not exists idx_events_player_slot on public.events (player_slot);

alter table public.games enable row level security;
alter table public.events enable row level security;

drop policy if exists "games_select_all" on public.games;
drop policy if exists "games_insert_all" on public.games;
drop policy if exists "games_update_all" on public.games;
drop policy if exists "games_delete_all" on public.games;
drop policy if exists "events_select_all" on public.events;
drop policy if exists "events_insert_all" on public.events;
drop policy if exists "events_update_all" on public.events;
drop policy if exists "events_delete_all" on public.events;

create policy "games_select_all"
on public.games
for select
using (true);

create policy "games_insert_all"
on public.games
for insert
with check (true);

create policy "games_update_all"
on public.games
for update
using (true)
with check (true);

create policy "games_delete_all"
on public.games
for delete
using (true);

create policy "events_select_all"
on public.events
for select
using (true);

create policy "events_insert_all"
on public.events
for insert
with check (true);

create policy "events_update_all"
on public.events
for update
using (true)
with check (true);

create policy "events_delete_all"
on public.events
for delete
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end
$$;
