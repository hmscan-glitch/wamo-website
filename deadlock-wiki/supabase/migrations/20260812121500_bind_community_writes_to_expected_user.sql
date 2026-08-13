drop function if exists public.create_community_post(text);
drop function if exists public.update_community_post(uuid, text);
drop function if exists public.delete_community_post(uuid);
drop function if exists public.report_community_post(uuid, text);

create function public.create_community_post(p_content text, p_expected_user_id uuid)
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
  if v_uid is null then raise exception 'Bitte melde dich an.' using errcode = 'P0001'; end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001';
  end if;
  select users.email_confirmed_at is not null into v_confirmed from auth.users as users where users.id = v_uid;
  if not coalesce(v_confirmed, false) then raise exception 'Bitte bestätige zuerst deine E-Mail-Adresse.' using errcode = 'P0001'; end if;
  v_content := pg_catalog.regexp_replace(coalesce(p_content, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if pg_catalog.char_length(v_content) not between 1 and 1000 then raise exception 'Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1942));
  delete from private.community_post_rate_events where user_id = v_uid and created_at <= now() - interval '24 hours';
  if exists (select 1 from private.community_post_rate_events where user_id = v_uid and created_at > now() - interval '30 seconds') then
    raise exception 'Bitte warte kurz, bevor du einen weiteren Beitrag veröffentlichst.' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from private.community_post_rate_events where user_id = v_uid and created_at > now() - interval '1 hour') >= 12 then
    raise exception 'Du hast das stündliche Beitragslimit erreicht.' using errcode = 'P0001';
  end if;
  insert into public.profiles (id, display_name) values (v_uid, 'Mitglied-' || pg_catalog.left(pg_catalog.replace(v_uid::text, '-', ''), 8)) on conflict (id) do nothing;
  insert into public.community_posts (user_id, content) values (v_uid, v_content) returning id into v_post_id;
  insert into private.community_post_rate_events (user_id) values (v_uid);
  return v_post_id;
end;
$$;

create function public.update_community_post(p_post_id uuid, p_content text, p_expected_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_content text; v_confirmed boolean := false; v_updated_at timestamptz;
begin
  if v_uid is null then raise exception 'Bitte melde dich an.' using errcode = 'P0001'; end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001'; end if;
  select users.email_confirmed_at is not null into v_confirmed from auth.users as users where users.id = v_uid;
  if not coalesce(v_confirmed, false) then raise exception 'Bitte bestätige zuerst deine E-Mail-Adresse.' using errcode = 'P0001'; end if;
  v_content := pg_catalog.regexp_replace(coalesce(p_content, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if pg_catalog.char_length(v_content) not between 1 and 1000 then raise exception 'Der Beitrag muss zwischen 1 und 1000 Zeichen lang sein.' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1942));
  select post.updated_at into v_updated_at from public.community_posts as post where post.id = p_post_id and post.user_id = v_uid and post.status = 'published';
  if not found then raise exception 'Der Beitrag wurde nicht gefunden oder gehört nicht dir.' using errcode = 'P0001'; end if;
  if v_updated_at > now() - interval '3 seconds' then raise exception 'Bitte warte kurz, bevor du erneut speicherst.' using errcode = 'P0001'; end if;
  update public.community_posts set content = v_content where id = p_post_id and user_id = v_uid and status = 'published';
end;
$$;

create function public.delete_community_post(p_post_id uuid, p_expected_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Bitte melde dich an.' using errcode = 'P0001'; end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001'; end if;
  delete from public.community_posts where id = p_post_id and user_id = v_uid;
  if not found then raise exception 'Der Beitrag wurde nicht gefunden oder gehört nicht dir.' using errcode = 'P0001'; end if;
end;
$$;

create function public.report_community_post(p_post_id uuid, p_reason text, p_expected_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_reason text; v_confirmed boolean := false; v_author uuid; v_report_id uuid;
begin
  if v_uid is null then raise exception 'Bitte melde dich an.' using errcode = 'P0001'; end if;
  if p_expected_user_id is null or p_expected_user_id <> v_uid then raise exception 'Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.' using errcode = 'P0001'; end if;
  select users.email_confirmed_at is not null into v_confirmed from auth.users as users where users.id = v_uid;
  if not coalesce(v_confirmed, false) then raise exception 'Bitte bestätige zuerst deine E-Mail-Adresse.' using errcode = 'P0001'; end if;
  v_reason := pg_catalog.regexp_replace(coalesce(p_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if pg_catalog.char_length(v_reason) not between 1 and 300 then raise exception 'Der Meldegrund muss zwischen 1 und 300 Zeichen lang sein.' using errcode = 'P0001'; end if;
  select post.user_id into v_author from public.community_posts as post where post.id = p_post_id and post.status = 'published';
  if not found then raise exception 'Dieser Beitrag kann nicht gemeldet werden.' using errcode = 'P0001'; end if;
  if v_author = v_uid then raise exception 'Du kannst deinen eigenen Beitrag nicht melden.' using errcode = 'P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 1942));
  if exists (select 1 from public.post_reports where post_id = p_post_id and reporter_id = v_uid) then raise exception 'Du hast diesen Beitrag bereits gemeldet.' using errcode = 'P0001'; end if;
  if (select pg_catalog.count(*) from public.post_reports where reporter_id = v_uid and created_at > now() - interval '1 hour') >= 5 then raise exception 'Du hast das stündliche Meldelimit erreicht.' using errcode = 'P0001'; end if;
  insert into public.post_reports (post_id, reporter_id, reason) values (p_post_id, v_uid, v_reason) returning id into v_report_id;
  return v_report_id;
end;
$$;

revoke all on function public.create_community_post(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_community_post(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_community_post(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_community_post(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_community_post(text, uuid) to authenticated;
grant execute on function public.update_community_post(uuid, text, uuid) to authenticated;
grant execute on function public.delete_community_post(uuid, uuid) to authenticated;
grant execute on function public.report_community_post(uuid, text, uuid) to authenticated;

revoke all on table public.post_reports, public.community_posts from service_role;
grant select, delete on table public.post_reports to service_role;
grant update (status, resolved_at) on table public.post_reports to service_role;
grant select, delete on table public.community_posts to service_role;
grant update (status) on table public.community_posts to service_role;
