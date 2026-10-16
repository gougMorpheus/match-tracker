-- 2026-10-16: Web-Push Stufe (b). Additiv: alte App-Versionen speichern unveraendert (kein APP_SCHEMA_VERSION-Sprung).
-- Backup vorher: /home/box/ops/backup/match-tracker-2026-10-16-vor-push-b/
-- Rollback: 20261016_02_web_push.rollback.sql
--
-- - pg_net fuer asynchrone HTTP-Aufrufe aus dem Trigger.
-- - push_subscriptions: ein Abo pro Geraet (device_id aus Stufe a). RLS an, KEINE Policies, keine Tabellenrechte fuer
--   anon/authenticated -> Endpoints/Schluessel sind mit dem Publishable Key nicht lesbar. Zugriff nur ueber RPCs.
-- - push_sent_highlights: Dedupe, Unique(game_id, highlight_key). Die Function traegt erst ein, dann sendet sie.
-- - Trigger AFTER INSERT auf events -> pg_net -> Netlify Function (Header x-mt-push-secret). Fehlertolerant: Fehler
--   werden abgefangen (WARNING), das Speichern des Events scheitert nie.
-- - Secret und Function-URL liegen in Supabase Vault (mt_push_secret, mt_push_url); werden NICHT hier gesetzt,
--   sondern separat (Wert nie im Repo). Ohne Vault-Eintraege macht der Trigger nichts.
begin;

create extension if not exists pg_net with schema extensions;

create schema if not exists mt_private;
revoke all on schema mt_private from public, anon, authenticated;

create table if not exists public.push_subscriptions (
  device_id uuid primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  auto_follow boolean not null default false,
  auto_follow_since timestamptz,
  followed_games uuid[] not null default '{}',
  unfollowed_games uuid[] not null default '{}',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_push_at timestamptz,
  constraint push_subscriptions_endpoint_https check (endpoint ~ '^https://' and length(endpoint) <= 1024),
  constraint push_subscriptions_keys check (length(p256dh) between 40 and 200 and length(auth) between 8 and 100),
  constraint push_subscriptions_follow_limit check (cardinality(followed_games) <= 500 and cardinality(unfollowed_games) <= 2000)
);
create index if not exists push_subscriptions_followed_idx on public.push_subscriptions using gin (followed_games);

create table if not exists public.push_sent_highlights (
  game_id uuid not null references public.games(id) on delete cascade,
  highlight_key text not null,
  event_id uuid,
  title text,
  body text,
  created_at timestamptz not null default now(),
  recipients integer,
  delivered integer,
  failed integer,
  removed integer,
  constraint push_sent_highlights_unique unique (game_id, highlight_key)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_sent_highlights enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.push_sent_highlights from public, anon, authenticated;

-- Hilfsfunktionen (privat).
create or replace function mt_private.vault_value(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name order by created_at desc limit 1
$$;

create or replace function mt_private.check_push_secret(p_secret text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare s text := mt_private.vault_value('mt_push_secret');
begin
  if s is null or p_secret is null or length(p_secret) < 32 or p_secret <> s then
    raise exception using errcode = '42501', message = 'mt_push: forbidden';
  end if;
end $$;

-- Wie die App (isSupabaseGameDeleted): deleted_at ODER notes.deletedMeta.deletedAt.
create or replace function mt_private.game_is_deleted(p_deleted_at timestamptz, p_notes text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_deleted_at is not null then return true; end if;
  if p_notes is null or p_notes not like '%deletedMeta%' then return false; end if;
  return coalesce(nullif(btrim(p_notes::jsonb -> 'deletedMeta' ->> 'deletedAt'), ''), null) is not null;
exception when others then
  return false;
end $$;

create or replace function mt_private.live_game_ids(p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct g.id), '{}') from public.games g
  where g.id = any(coalesce(p_ids, '{}')) and not mt_private.game_is_deleted(g.deleted_at, g.notes)
$$;

-- RPCs fuer die App (Publishable Key). Liefern nie Endpoints/Schluessel zurueck.
create or replace function public.mt_push_subscribe(p_device_id uuid, p_endpoint text, p_p256dh text, p_auth text,
  p_auto_follow boolean default false, p_auto_follow_since timestamptz default null,
  p_followed uuid[] default '{}', p_unfollowed uuid[] default '{}', p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_followed uuid[];
begin
  if p_device_id is null or p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception using errcode = '22023', message = 'mt_push_subscribe: unvollstaendig';
  end if;
  v_followed := mt_private.live_game_ids(p_followed[1:500]);
  -- Gleicher Endpoint mit neuer Geraete-ID (z. B. Speicher geloescht): altes Abo ersetzen.
  delete from public.push_subscriptions where endpoint = p_endpoint and device_id <> p_device_id;
  insert into public.push_subscriptions as s (device_id, endpoint, p256dh, auth, auto_follow, auto_follow_since,
    followed_games, unfollowed_games, user_agent)
  values (p_device_id, p_endpoint, p_p256dh, p_auth, coalesce(p_auto_follow, false),
    case when p_auto_follow then coalesce(p_auto_follow_since, now()) end, v_followed,
    coalesce(p_unfollowed[1:2000], '{}'), left(p_user_agent, 300))
  on conflict (device_id) do update set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
    auto_follow = excluded.auto_follow, auto_follow_since = excluded.auto_follow_since,
    followed_games = excluded.followed_games, unfollowed_games = excluded.unfollowed_games,
    user_agent = excluded.user_agent, updated_at = now();
  return jsonb_build_object('ok', true, 'followed', cardinality(v_followed));
end $$;

create or replace function public.mt_push_set_follows(p_device_id uuid, p_auto_follow boolean,
  p_auto_follow_since timestamptz, p_followed uuid[], p_unfollowed uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_followed uuid[]; n int;
begin
  v_followed := mt_private.live_game_ids(p_followed[1:500]);
  update public.push_subscriptions set auto_follow = coalesce(p_auto_follow, false),
    auto_follow_since = case when p_auto_follow then coalesce(p_auto_follow_since, auto_follow_since, now()) end,
    followed_games = v_followed, unfollowed_games = coalesce(p_unfollowed[1:2000], '{}'), updated_at = now()
  where device_id = p_device_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'subscribed', n > 0, 'followed', cardinality(v_followed));
end $$;

create or replace function public.mt_push_unsubscribe(p_device_id uuid, p_endpoint text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.push_subscriptions where device_id = p_device_id and (p_endpoint is null or endpoint = p_endpoint);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removed', n);
end $$;

create or replace function public.mt_push_status(p_device_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('subscribed', count(*) > 0, 'followed', coalesce(max(cardinality(followed_games)), 0),
    'auto_follow', coalesce(bool_or(auto_follow), false))
  from public.push_subscriptions where device_id = p_device_id
$$;

-- RPCs fuer die Netlify Function (nur mit Secret).
create or replace function public.mt_push_claim(p_secret text, p_game_id uuid, p_event_id uuid, p_items jsonb)
returns setof text language plpgsql security definer set search_path = '' as $$
begin
  perform mt_private.check_push_secret(p_secret);
  -- Atomar: bei parallelen Aufrufen gewinnt genau einer je (game_id, highlight_key).
  return query
    with ins as (
      insert into public.push_sent_highlights (game_id, highlight_key, event_id, title, body)
      select p_game_id, i ->> 'key', p_event_id, left(i ->> 'title', 200), left(i ->> 'body', 500)
      from jsonb_array_elements(coalesce(p_items, '[]')) i where coalesce(i ->> 'key', '') <> ''
      on conflict (game_id, highlight_key) do nothing
      returning highlight_key)
    select ins.highlight_key from ins;
end $$;

create or replace function public.mt_push_targets(p_secret text, p_game_id uuid)
returns table (device_id uuid, endpoint text, p256dh text, auth text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform mt_private.check_push_secret(p_secret);
  return query
    select s.device_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s join public.games g on g.id = p_game_id
    where not mt_private.game_is_deleted(g.deleted_at, g.notes)
      and (p_game_id = any(s.followed_games)
        or (s.auto_follow and s.auto_follow_since is not null and g.created_at >= s.auto_follow_since
            and not (p_game_id = any(s.unfollowed_games))));
end $$;

create or replace function public.mt_push_report(p_secret text, p_game_id uuid, p_keys text[], p_recipients int,
  p_delivered int, p_failed int, p_gone uuid[], p_ok uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform mt_private.check_push_secret(p_secret);
  delete from public.push_subscriptions where device_id = any(coalesce(p_gone, '{}'));
  get diagnostics n = row_count;
  update public.push_subscriptions set last_push_at = now() where device_id = any(coalesce(p_ok, '{}'));
  update public.push_sent_highlights set recipients = p_recipients, delivered = p_delivered, failed = p_failed, removed = n
  where game_id = p_game_id and highlight_key = any(coalesce(p_keys, '{}'));
  return jsonb_build_object('ok', true, 'removed', n);
end $$;

revoke all on function public.mt_push_subscribe(uuid, text, text, text, boolean, timestamptz, uuid[], uuid[], text) from public;
revoke all on function public.mt_push_set_follows(uuid, boolean, timestamptz, uuid[], uuid[]) from public;
revoke all on function public.mt_push_unsubscribe(uuid, text) from public;
revoke all on function public.mt_push_status(uuid) from public;
revoke all on function public.mt_push_claim(text, uuid, uuid, jsonb) from public;
revoke all on function public.mt_push_targets(text, uuid) from public;
revoke all on function public.mt_push_report(text, uuid, text[], int, int, int, uuid[], uuid[]) from public;
grant execute on function public.mt_push_subscribe(uuid, text, text, text, boolean, timestamptz, uuid[], uuid[], text) to anon, authenticated;
grant execute on function public.mt_push_set_follows(uuid, boolean, timestamptz, uuid[], uuid[]) to anon, authenticated;
grant execute on function public.mt_push_unsubscribe(uuid, text) to anon, authenticated;
grant execute on function public.mt_push_status(uuid) to anon, authenticated;
grant execute on function public.mt_push_claim(text, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.mt_push_targets(text, uuid) to anon, authenticated;
grant execute on function public.mt_push_report(text, uuid, text[], int, int, int, uuid[], uuid[]) to anon, authenticated;
revoke all on all functions in schema mt_private from public, anon, authenticated;

-- Trigger: Event gespeichert -> asynchron Netlify Function aufrufen. Nie werfen.
create or replace function mt_private.push_on_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  begin
    if not exists (select 1 from public.push_subscriptions s
                   where s.auto_follow or new.game_id = any(s.followed_games)) then
      return null;
    end if;
    v_url := mt_private.vault_value('mt_push_url');
    v_secret := mt_private.vault_value('mt_push_secret');
    if v_url is null or v_secret is null then return null; end if;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('game_id', new.game_id, 'event_id', new.id, 'event_type', new.event_type),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-mt-push-secret', v_secret),
      timeout_milliseconds := 10000);
  exception when others then
    raise warning 'mt_push trigger: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end $$;

-- Geloeschte Spiele fallen serverseitig aus den gefolgten Spielen heraus (mt_delete_game setzt deleted_at).
create or replace function mt_private.push_on_game_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    update public.push_subscriptions set followed_games = array_remove(followed_games, new.id), updated_at = now()
    where new.id = any(followed_games);
  exception when others then
    raise warning 'mt_push delete trigger: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end $$;
revoke all on all functions in schema mt_private from public, anon, authenticated;

drop trigger if exists mt_push_after_event_insert on public.events;
create trigger mt_push_after_event_insert after insert on public.events
  for each row
  when (new.revoked_by is null and new.event_type not in ('revoke', 'restore', 'note', 'cp-gained', 'cp-spent'))
  execute function mt_private.push_on_event();

drop trigger if exists mt_push_after_game_deleted on public.games;
create trigger mt_push_after_game_deleted after update of deleted_at, notes on public.games
  for each row
  when (old.deleted_at is null and (new.deleted_at is not null or new.notes like '%deletedMeta%'))
  execute function mt_private.push_on_game_deleted();

commit;
