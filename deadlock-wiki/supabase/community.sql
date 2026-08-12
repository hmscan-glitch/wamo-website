-- Deadlock Wiki: Profile, Community-Feed und sichere Schreiboperationen
-- Vollständiges Bootstrap-Skript für ein neues Projekt. Bei bestehenden
-- Projekten ausschließlich die versionierten Dateien unter migrations/ nutzen.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Funktionen sind in PostgreSQL standardmäßig für PUBLIC ausführbar. Für dieses
-- Skript bleiben nur die unten ausdrücklich freigegebenen RPCs erreichbar.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar text not null default 'abrams',
  steam_id text,
  favorites text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 2 and 24),
  constraint profiles_display_name_plain check (display_name !~ '[[:cntrl:]]'),
  constraint profiles_avatar_slug check (avatar ~ '^[a-z0-9-]{1,40}$'),
  constraint profiles_steam_id_format check (steam_id is null or steam_id ~ '^[0-9]{1,10}$'),
  constraint profiles_favorites_limit check (cardinality(favorites) <= 100)
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  content text not null,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_posts_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint community_posts_content_length check (char_length(content) between 1 and 1000),
  constraint community_posts_status check (status in ('published', 'hidden'))
);

alter table public.profiles drop constraint if exists profiles_favorites_format;
alter table public.profiles add constraint profiles_favorites_format check (
  pg_catalog.cardinality(favorites) = 0
  or (
    pg_catalog.array_position(favorites, null) is null
    and pg_catalog.array_to_string(favorites, '|') ~ '^[a-z0-9-]{1,60}([|][a-z0-9-]{1,60})*$'
  )
);

create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint post_reports_reason_length check (char_length(reason) between 1 and 300),
  constraint post_reports_status check (status in ('open', 'resolved', 'dismissed')),
  constraint post_reports_once_per_user unique (post_id, reporter_id)
);

-- Interne, nicht Ã¼ber die Data API freigegebene Ereignisse verhindern, dass
-- das Beitragslimit durch sofortiges LÃ¶schen eines Posts umgangen wird.
create table if not exists private.community_post_rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists community_posts_published_created_idx
  on public.community_posts (created_at desc)
  where status = 'published';
create index if not exists community_posts_user_created_idx
  on public.community_posts (user_id, created_at desc);
create index if not exists post_reports_reporter_created_idx
  on public.post_reports (reporter_id, created_at desc);
create index if not exists post_reports_open_idx
  on public.post_reports (created_at asc)
  where status = 'open';
create index if not exists community_post_rate_events_user_created_idx
  on private.community_post_rate_events (user_id, created_at desc);
alter table private.community_post_rate_events enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists community_posts_set_updated_at on public.community_posts;
create trigger community_posts_set_updated_at
before update on public.community_posts
for each row execute function public.set_updated_at();

revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_avatar text;
begin
  v_name := pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if pg_catalog.char_length(v_name) < 2 or pg_catalog.char_length(v_name) > 24 or v_name ~ '[[:cntrl:]]' then
    v_name := 'Mitglied-' || pg_catalog.left(pg_catalog.replace(new.id::text, '-', ''), 8);
  end if;

  v_avatar := pg_catalog.lower(coalesce(new.raw_user_meta_data ->> 'avatar', 'abrams'));
  if v_avatar !~ '^[a-z0-9-]{1,40}$' then
    v_avatar := 'abrams';
  end if;

  insert into public.profiles (id, display_name, avatar)
  values (new.id, v_name, v_avatar)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

-- Falls vor dem Ausführen des Skripts bereits Testnutzer angelegt wurden.
insert into public.profiles (id, display_name, avatar, created_at)
select
  users.id,
  case
    when pg_catalog.char_length(pg_catalog.btrim(coalesce(users.raw_user_meta_data ->> 'display_name', ''))) between 2 and 24
      and pg_catalog.btrim(coalesce(users.raw_user_meta_data ->> 'display_name', '')) !~ '[[:cntrl:]]'
    then pg_catalog.btrim(users.raw_user_meta_data ->> 'display_name')
    else 'Mitglied-' || pg_catalog.left(pg_catalog.replace(users.id::text, '-', ''), 8)
  end,
  case
    when pg_catalog.lower(coalesce(users.raw_user_meta_data ->> 'avatar', '')) ~ '^[a-z0-9-]{1,40}$'
    then pg_catalog.lower(users.raw_user_meta_data ->> 'avatar')
    else 'abrams'
  end,
  users.created_at
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.community_posts enable row level security;
alter table public.post_reports enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Kein öffentlicher Zugriff auf profiles: Steam-ID und Favoriten bleiben privat.
drop policy if exists community_posts_read_published on public.community_posts;
create policy community_posts_read_published
on public.community_posts for select
to anon, authenticated
using (status = 'published');

drop policy if exists post_reports_select_own on public.post_reports;
create policy post_reports_select_own
on public.post_reports for select
to authenticated
using ((select auth.uid()) = reporter_id);

-- Der Feed gibt ausschließlich die ausdrücklich öffentlichen Profilfelder aus.
drop function if exists public.get_community_posts(integer, integer);
drop function if exists public.create_community_post(text);
drop function if exists public.update_community_post(uuid, text);
drop function if exists public.delete_community_post(uuid);
drop function if exists public.report_community_post(uuid, text);
create function public.get_community_posts(p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid,
  is_owner boolean,
  content text,
  created_at timestamptz,
  updated_at timestamptz,
  display_name text,
  avatar text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id,
    post.user_id = (select auth.uid()),
    post.content,
    post.created_at,
    post.updated_at,
    profile.display_name,
    profile.avatar
  from public.community_posts as post
  join public.profiles as profile on profile.id = post.user_id
  where post.status = 'published'
  order by post.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

create or replace function public.create_community_post(p_content text, p_expected_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_content text;
  v_confirmed boolean := false;
  v_post_id uuid;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich an.' using errcode = 'P0001';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001';
  end if;

  select users.email_confirmed_at is not null
  into v_confirmed
  from auth.users as users
  where users.id = v_uid;
  if not coalesce(v_confirmed, false) then
    raise exception 'Bitte bestätige zuerst deine E-Mail-Adresse.' using errcode = 'P0001';
  end if;

  v_content := pg_catalog.regexp_replace(coalesce(p_content, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if pg_catalog.char_length(v_content) not between 1 and 1000 then
    raise exception 'Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1942));
  delete from private.community_post_rate_events
  where user_id = v_uid and created_at <= now() - interval '24 hours';
  if exists (
    select 1 from private.community_post_rate_events
    where user_id = v_uid and created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Bitte warte kurz, bevor du einen weiteren Beitrag veröffentlichst.' using errcode = 'P0001';
  end if;
  if (
    select pg_catalog.count(*) from private.community_post_rate_events
    where user_id = v_uid and created_at > now() - interval '1 hour'
  ) >= 12 then
    raise exception 'Du hast das stündliche Beitragslimit erreicht.' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, 'Mitglied-' || pg_catalog.left(pg_catalog.replace(v_uid::text, '-', ''), 8))
  on conflict (id) do nothing;

  insert into public.community_posts (user_id, content)
  values (v_uid, v_content)
  returning id into v_post_id;
  insert into private.community_post_rate_events (user_id) values (v_uid);
  return v_post_id;
end;
$$;

create or replace function public.update_community_post(p_post_id uuid, p_content text, p_expected_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_content text;
  v_confirmed boolean := false;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich an.' using errcode = 'P0001';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001';
  end if;
  select users.email_confirmed_at is not null into v_confirmed
  from auth.users as users where users.id = v_uid;
  if not coalesce(v_confirmed, false) then
    raise exception 'Bitte bestätige zuerst deine E-Mail-Adresse.' using errcode = 'P0001';
  end if;

  v_content := pg_catalog.regexp_replace(coalesce(p_content, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if pg_catalog.char_length(v_content) not between 1 and 1000 then
    raise exception 'Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1942));
  select post.updated_at into v_updated_at
  from public.community_posts as post
  where post.id = p_post_id and post.user_id = v_uid and post.status = 'published';
  if not found then
    raise exception 'Der Beitrag wurde nicht gefunden oder gehört nicht dir.' using errcode = 'P0001';
  end if;
  if v_updated_at > now() - interval '3 seconds' then
    raise exception 'Bitte warte kurz, bevor du erneut speicherst.' using errcode = 'P0001';
  end if;

  update public.community_posts
  set content = v_content
  where id = p_post_id and user_id = v_uid and status = 'published';
end;
$$;

create or replace function public.delete_community_post(p_post_id uuid, p_expected_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Bitte melde dich an.' using errcode = 'P0001';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001';
  end if;
  delete from public.community_posts
  where id = p_post_id and user_id = v_uid;
  if not found then
    raise exception 'Der Beitrag wurde nicht gefunden oder gehört nicht dir.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.report_community_post(p_post_id uuid, p_reason text, p_expected_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text;
  v_confirmed boolean := false;
  v_author uuid;
  v_report_id uuid;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich an.' using errcode = 'P0001';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001';
  end if;
  select users.email_confirmed_at is not null into v_confirmed
  from auth.users as users where users.id = v_uid;
  if not coalesce(v_confirmed, false) then
    raise exception 'Bitte bestätige zuerst deine E-Mail-Adresse.' using errcode = 'P0001';
  end if;

  v_reason := pg_catalog.regexp_replace(coalesce(p_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if pg_catalog.char_length(v_reason) not between 1 and 300 then
    raise exception 'Der Meldegrund muss zwischen 1 und 300 Zeichen lang sein.' using errcode = 'P0001';
  end if;

  select post.user_id into v_author
  from public.community_posts as post
  where post.id = p_post_id and post.status = 'published';
  if not found then
    raise exception 'Dieser Beitrag kann nicht gemeldet werden.' using errcode = 'P0001';
  end if;
  if v_author = v_uid then
    raise exception 'Du kannst deinen eigenen Beitrag nicht melden.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1942));
  if exists (
    select 1 from public.post_reports where post_id = p_post_id and reporter_id = v_uid
  ) then
    raise exception 'Du hast diesen Beitrag bereits gemeldet.' using errcode = 'P0001';
  end if;
  if (
    select pg_catalog.count(*) from public.post_reports
    where reporter_id = v_uid and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Du hast das stündliche Meldelimit erreicht.' using errcode = 'P0001';
  end if;

  insert into public.post_reports (post_id, reporter_id, reason)
  values (p_post_id, v_uid, v_reason)
  returning id into v_report_id;
  return v_report_id;
end;
$$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session_id uuid;
  v_session_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Bitte melde dich an.' using errcode = 'P0001';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    v_session_id := null;
  end;

  select sessions.created_at
  into v_session_created_at
  from auth.sessions as sessions
  where sessions.id = v_session_id
    and sessions.user_id = v_uid;

  if v_session_created_at is null or v_session_created_at < now() - interval '5 minutes' then
    raise exception 'Bitte melde dich direkt vor dem Löschen erneut an.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = v_uid;
  if not found then
    raise exception 'Das Konto wurde nicht gefunden.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.community_posts from anon, authenticated;
revoke all on table public.post_reports from anon, authenticated;
revoke all on table private.community_post_rate_events from public, anon, authenticated, service_role;

grant select on table public.profiles to authenticated;
grant insert (id, display_name, avatar, steam_id, favorites) on table public.profiles to authenticated;
grant update (display_name, avatar, steam_id, favorites) on table public.profiles to authenticated;
revoke all on table public.post_reports, public.community_posts from service_role;
grant select, delete on table public.post_reports to service_role;
grant update (status, resolved_at) on table public.post_reports to service_role;
grant select, delete on table public.community_posts to service_role;
grant update (status) on table public.community_posts to service_role;

revoke all on function public.get_community_posts(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.create_community_post(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_community_post(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_community_post(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_community_post(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;

grant execute on function public.get_community_posts(integer, integer) to anon, authenticated;
grant execute on function public.create_community_post(text, uuid) to authenticated;
grant execute on function public.update_community_post(uuid, text, uuid) to authenticated;
grant execute on function public.delete_community_post(uuid, uuid) to authenticated;
grant execute on function public.report_community_post(uuid, text, uuid) to authenticated;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.get_community_posts(integer, integer) is
  'Öffentlicher, datensparsamer Community-Feed ohne private Profilfelder.';
comment on table public.post_reports is
  'Nicht öffentliche Moderationswarteschlange; der service_role kann sie verwalten.';
comment on table private.community_post_rate_events is
  'Interne, nicht exponierte Ereignisse zur robusten Begrenzung von Beitragserstellungen.';
