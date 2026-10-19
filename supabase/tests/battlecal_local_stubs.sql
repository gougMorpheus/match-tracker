-- NUR lokal (Test-Postgres): Supabase-Umgebung nachbilden. Nie gegen die Live-DB ausfuehren.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then raise exception 'Abbruch: sieht nach Supabase aus, Stubs nur lokal'; end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema extensions; create extension pgcrypto schema extensions;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz default now());
-- Match-Tracker-Attrappe, um "unveraendert" pruefen zu koennen
create table public.games (id uuid primary key default gen_random_uuid(), player1_name text);
create table public.events (id uuid primary key default gen_random_uuid(), game_id uuid);
create function public.mt_schema_info() returns jsonb language sql as $$ select '{}'::jsonb $$;
create publication supabase_realtime for table public.games, public.events;
grant usage on schema public to anon, authenticated;
grant select on public.games, public.events to anon;
