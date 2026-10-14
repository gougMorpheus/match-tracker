-- VORSCHLAG, NICHT AUSGEFUEHRT (keine Freigabe). Serverseitige Sperre abgeschlossener Spiele + Passwort als bcrypt-Hash.
-- Voraussetzung vor dem Einspielen:
--   1) Neues Admin-Passwort waehlen (das bisherige steht im oeffentlichen Repo/Bundle und gilt als verbrannt).
--   2) Nach dem Einspielen einmalig (nicht ins Repo!):
--      insert into public.mt_admin_secret (id, password_hash) values (1, extensions.crypt('<NEUES_PASSWORT>', extensions.gen_salt('bf', 12)));
--   3) Client-Anbindung (mt_unlock_game + Header x-mt-edit-token) per eigenem PR, erst danach Client-Konstante entfernen.
-- Grenze: Laufende Spiele kann der Server nicht nach Edit/View unterscheiden (alle nutzen denselben Publishable Key);
--         das waere nur mit Login oder einem Edit-Token pro Geraet loesbar.
-- Vor dem Einspielen auf einer Kopie testen, insbesondere "Spiel beenden" (Schonfrist 30 min nach ended_at fuer Offline-Queue).
begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mt_admin_secret (
  id int primary key check (id = 1),
  password_hash text not null
);
alter table public.mt_admin_secret enable row level security;
revoke all on public.mt_admin_secret from public, anon, authenticated;

create table if not exists public.mt_edit_grants (
  token uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.mt_edit_grants enable row level security;
revoke all on public.mt_edit_grants from public, anon, authenticated;

-- Passwortpruefung nur serverseitig (bcrypt via pgcrypto). Kein Hash/Wert verlaesst die DB.
create or replace function public.mt_check_admin_password(p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  select password_hash into h from public.mt_admin_secret where id = 1;
  if h is null or p_password is null then return false; end if;
  if extensions.crypt(p_password, h) = h then return true; end if;
  perform pg_sleep(0.5); -- bremst Durchprobieren
  return false;
end $$;

-- Entsperren: liefert ein Edit-Token (12 h) fuer dieses Spiel.
create or replace function public.mt_unlock_game(p_game_id uuid, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not public.mt_check_admin_password(p_password) then
    raise exception using errcode = 'PT403', message = 'mt_wrong_password';
  end if;
  delete from public.mt_edit_grants where expires_at < now();
  insert into public.mt_edit_grants (game_id, expires_at) values (p_game_id, now() + interval '12 hours') returning token into t;
  return jsonb_build_object('token', t, 'expires_in_s', 43200);
end $$;

create or replace function public.mt_has_edit_grant(p_game_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare tok text;
begin
  tok := coalesce(current_setting('request.headers', true), '{}')::json->>'x-mt-edit-token';
  if tok is null or tok !~ '^[0-9a-f-]{36}$' then return false; end if;
  return exists (select 1 from public.mt_edit_grants where token = tok::uuid and game_id = p_game_id and expires_at > now());
end $$;

create or replace function public.mt_is_locked(p_ended_at timestamptz)
returns boolean language sql stable as $$
  select p_ended_at is not null and p_ended_at < now() - interval '30 minutes'
$$;

create or replace function public.mt_guard_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare ended timestamptz;
begin
  select ended_at into ended from public.games where id = coalesce(new.game_id, old.game_id);
  if public.mt_is_locked(ended) and not public.mt_has_edit_grant(coalesce(new.game_id, old.game_id)) then
    raise exception using errcode = 'PT423', message = 'mt_locked';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.mt_guard_games() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.mt_is_locked(old.ended_at) and not public.mt_has_edit_grant(old.id) then
    raise exception using errcode = 'PT423', message = 'mt_locked';
  end if;
  return new;
end $$;

drop trigger if exists mt_guard_events on public.events;
create trigger mt_guard_events before insert or update or delete on public.events
  for each row execute function public.mt_guard_events();
drop trigger if exists mt_guard_games on public.games;
create trigger mt_guard_games before update on public.games
  for each row execute function public.mt_guard_games();

revoke all on function public.mt_check_admin_password(text) from public;
revoke all on function public.mt_unlock_game(uuid, text) from public;
revoke all on function public.mt_has_edit_grant(uuid) from public, anon, authenticated;
grant execute on function public.mt_check_admin_password(text) to anon, authenticated;
grant execute on function public.mt_unlock_game(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
