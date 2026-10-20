-- Fase 2: sincronização com o app, Google Calendar e Web Push.

-- ---------------------------------------------------------------------------
-- colunas que o app usa e o modelo inicial não tinha
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists app_settings jsonb;                 -- configurações completas do app

alter table public.fixed_commitments
  add column if not exists origin text not null default 'manual' check (origin in ('onboarding', 'manual'));

alter table public.tasks
  add column if not exists unplaced_reason text;

alter table public.plans
  add column if not exists task_ids uuid[] not null default '{}',
  add column if not exists excluded_task_ids uuid[] not null default '{}',
  add column if not exists event_ids uuid[] not null default '{}',
  add column if not exists capture_id uuid,
  add column if not exists deleted_at timestamptz,
  alter column horizon_start drop not null,
  alter column horizon_end drop not null;

alter table public.checkins
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table public.routines
  add column if not exists start_date date not null default current_date;

alter table public.recipes
  add column if not exists active_min integer check (active_min > 0);

alter table public.shopping_items
  add column if not exists created_at timestamptz not null default now();

alter table public.devices
  add column if not exists deleted_at timestamptz;

-- deslocamentos apagados (soft delete) não podem bloquear o recadastro do mesmo trecho
alter table public.travel_times drop constraint if exists travel_times_user_id_from_place_id_to_place_id_key;
create unique index if not exists travel_times_unique_live on public.travel_times (user_id, from_place_id, to_place_id)
  where deleted_at is null;

-- um aviso por bloco, tipo e horário ("mais tempo" muda o horário do fim)
alter table public.notification_jobs drop constraint if exists notification_jobs_block_id_kind_key;
alter table public.notification_jobs add constraint notification_jobs_block_kind_fire_key unique (block_id, kind, fire_at);

-- o app gera os ids das etapas antes de enviar o pai; sem FK adiada o upsert
-- em lote falharia conforme a ordem
alter table public.tasks drop constraint if exists tasks_parent_id_fkey;
alter table public.tasks
  add constraint tasks_parent_id_fkey foreign key (parent_id) references public.tasks on delete cascade
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- updated_at sempre no relógio do servidor (é o cursor do sync), também no insert
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'places', 'travel_times', 'fixed_commitments', 'events',
    'captures', 'routines', 'tasks', 'plans', 'schedule_blocks', 'devices',
    'recipes', 'shopping_lists', 'shopping_items', 'checkins'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I
         for each row execute function public.set_updated_at()', t);
    execute format('create index if not exists %I on public.%I (user_id, updated_at)', t || '_sync', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- token do Google no Vault (só a service role chega aqui)
-- ---------------------------------------------------------------------------

create or replace function public.store_google_refresh_token(p_user uuid, p_token text, p_scopes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select refresh_token_secret_id into v_id from private.google_credentials where user_id = p_user;
  if v_id is null then
    v_id := vault.create_secret(p_token, 'google_refresh_' || p_user::text, 'Refresh token do Google Calendar');
    insert into private.google_credentials (user_id, refresh_token_secret_id, scopes, updated_at)
    values (p_user, v_id, coalesce(p_scopes, '{}'), now());
  else
    perform vault.update_secret(v_id, p_token);
    update private.google_credentials set scopes = coalesce(p_scopes, scopes), updated_at = now() where user_id = p_user;
  end if;
end;
$$;

create or replace function public.get_google_refresh_token(p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from private.google_credentials c
  join vault.decrypted_secrets s on s.id = c.refresh_token_secret_id
  where c.user_id = p_user;
$$;

create or replace function public.forget_google(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  delete from private.google_credentials where user_id = p_user returning refresh_token_secret_id into v_id;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
  delete from private.gcal_sync_state where user_id = p_user;
end;
$$;

create or replace function public.google_connected_users()
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  select user_id from private.google_credentials;
$$;

-- ---------------------------------------------------------------------------
-- segredo das chamadas do pg_cron para as Edge Functions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'cron_secret', 'pg_cron → Edge Functions');
  end if;
end $$;

create or replace function public.check_cron_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p_secret);
$$;

create or replace function public.mark_gcal_synced(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.gcal_sync_state (user_id, calendar_id, last_synced_at)
  values (p_user, 'all', now())
  on conflict (user_id, calendar_id) do update set last_synced_at = excluded.last_synced_at;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'store_google_refresh_token(uuid, text, text[])', 'get_google_refresh_token(uuid)', 'forget_google(uuid)',
    'google_connected_users()', 'check_cron_secret(text)', 'mark_gcal_synced(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- o app lê o próprio status de conexão com o Google
create or replace function public.google_status()
returns json
language sql
security definer
stable
set search_path = ''
as $$
  select json_build_object(
    'connected', exists (select 1 from private.google_credentials where user_id = auth.uid()),
    'last_synced_at', (select max(last_synced_at) from private.gcal_sync_state where user_id = auth.uid())
  );
$$;
revoke all on function public.google_status() from public, anon;
grant execute on function public.google_status() to authenticated;

-- ---------------------------------------------------------------------------
-- agendamentos (pg_cron + pg_net)
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.call_function(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'functions_url'),
    'https://pqvyqimddzkauyrnbxra.supabase.co/functions/v1'
  );
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  perform net.http_post(
    url := v_url || '/' || p_name,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- Web Push: a cada minuto, só se houver navegador inscrito
select cron.unschedule(jobid) from cron.job where jobname in ('agenda-push', 'agenda-gcal');
select cron.schedule('agenda-push', '* * * * *', $$
  select private.call_function('push-dispatch')
  where exists (select 1 from public.devices where platform = 'web' and notifications_enabled and deleted_at is null);
$$);
-- Google Calendar: a cada 15 minutos, só se alguém conectou a conta
select cron.schedule('agenda-gcal', '*/15 * * * *', $$
  select private.call_function('gcal-sync')
  where exists (select 1 from private.google_credentials);
$$);

-- ---------------------------------------------------------------------------
-- permissões das colunas novas já cobertas pelos GRANTs da tabela;
-- a fila de push é escrita pela service role
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.devices to authenticated;
