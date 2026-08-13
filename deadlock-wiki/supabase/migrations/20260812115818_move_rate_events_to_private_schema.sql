create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

alter table public.community_post_rate_events set schema private;
alter table private.community_post_rate_events disable row level security;
revoke all on table private.community_post_rate_events from public, anon, authenticated, service_role;

create or replace function public.create_community_post(p_content text)
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

revoke all on function public.create_community_post(text) from public, anon, authenticated, service_role;
grant execute on function public.create_community_post(text) to authenticated;

comment on table private.community_post_rate_events is
  'Interne, nicht exponierte Ereignisse zur robusten Begrenzung von Beitragserstellungen.';
