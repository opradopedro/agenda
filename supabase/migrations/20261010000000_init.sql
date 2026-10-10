-- Agenda IA — modelo de dados inicial
--
-- Convenções
--   * Instantes em timestamptz; horários de rotina em time + fuso do perfil
--     (padrão America/Sao_Paulo).
--   * Dia da semana: 0 = domingo … 6 = sábado (igual a Date.getDay()).
--   * "Enums" como text + check, para evoluir sem ALTER TYPE.
--   * updated_at / deleted_at nas tabelas sincronizadas com o app
--     (sync last-write-wins, exclusão lógica).
--   * A partir de 30/10/2026 o Supabase deixa de expor tabelas novas à Data API
--     automaticamente: os GRANTs no fim do arquivo são obrigatórios.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- utilitários
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- perfil e configurações
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id                       uuid primary key references auth.users on delete cascade,
  display_name                  text,
  timezone                      text not null default 'America/Sao_Paulo',
  wake_time                     time not null default '07:00',
  sleep_time                    time not null default '00:00',
  home_office_weekday           smallint default 3 check (home_office_weekday between 0 and 6),
  terminal_weekday              smallint check (terminal_weekday between 0 and 6),
  schedule_mode                 text not null default 'proposta'
                                  check (schedule_mode in ('direto', 'proposta')),

  -- notificações
  quiet_start                   time not null default '00:00',
  quiet_end                     time,            -- null = usa wake_time
  silent_mode                   boolean not null default false,
  notify_types                  jsonb not null default
                                  '{"inicio": true, "fim": true, "proposta": true}',
  default_alert_mode            text not null default 'lembrete'
                                  check (default_alert_mode in ('nenhum', 'lembrete', 'alarme')),
  reminder_lead_min             integer not null default 0 check (reminder_lead_min >= 0),
  more_time_default_min         integer not null default 15 check (more_time_default_min > 0),

  -- agendador
  slot_granularity_min          integer not null default 15 check (slot_granularity_min > 0),
  task_buffer_min               integer not null default 10 check (task_buffer_min >= 0),
  return_home_in_gaps           boolean not null default false,  -- entre compromissos fora, volta pra casa?
  go_home_min_stay_min          integer not null default 120 check (go_home_min_stay_min >= 0),
  errand_from_home_overhead_min integer not null default 30 check (errand_from_home_overhead_min >= 0),
  late_hour                     time not null default '22:00',  -- depois disso, custo extra

  -- Google Calendar
  gcal_calendar_id              text,            -- calendário "Agenda IA" criado pelo app
  gcal_read_calendar_ids        text[] not null default '{}',
  gcal_reminders                boolean not null default false,  -- false = eventos sem lembrete

  onboarding_done               boolean not null default false,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create table public.places (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null check (kind in ('casa', 'trabalho', 'terminal', 'faculdade', 'outro')),
  name        text not null,
  region      text,            -- cidade/bairro, ex.: 'Santos', 'Praia Grande'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index places_one_home on public.places (user_id)
  where kind = 'casa' and deleted_at is null;

-- Tempo de deslocamento (carro). Sem a volta cadastrada, o app usa a ida.
create table public.travel_times (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  from_place_id  uuid not null references public.places on delete cascade,
  to_place_id    uuid not null references public.places on delete cascade,
  minutes        integer not null check (minutes >= 0),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (user_id, from_place_id, to_place_id),
  check (from_place_id <> to_place_id)
);

-- Rotina fixa semanal: estágio (um registro por dia, com o lugar do dia),
-- faculdade, etc.
create table public.fixed_commitments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  title        text not null,
  category     text not null default 'trabalho'
                 check (category in ('pessoal', 'faculdade', 'tcc', 'empresa_junior', 'trabalho')),
  weekday      smallint not null check (weekday between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  place_id     uuid references public.places on delete set null,
  valid_from   date,
  valid_until  date,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (end_time > start_time)
);

-- Compromissos pontuais: lidos do Google Calendar ou capturados pela IA
-- ("quinta tenho prova").
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  source          text not null check (source in ('gcal', 'captura', 'manual')),
  title           text not null,
  category        text check (category in ('pessoal', 'faculdade', 'tcc', 'empresa_junior', 'trabalho')),
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  all_day         boolean not null default false,
  blocks_time     boolean not null default true,   -- false = "disponível" no Google
  place_id        uuid references public.places on delete set null,
  location_text   text,
  gcal_calendar_id text,
  gcal_event_id   text,
  gcal_etag       text,
  capture_id      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (end_at > start_at)
);
create unique index events_gcal_unique on public.events (user_id, gcal_calendar_id, gcal_event_id)
  where gcal_event_id is not null;
create index events_user_start on public.events (user_id, start_at);

-- ---------------------------------------------------------------------------
-- captura, tarefas e plano
-- ---------------------------------------------------------------------------

create table public.captures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  raw_text    text not null,
  input       text not null default 'texto' check (input in ('texto', 'voz')),
  status      text not null default 'pendente'
                check (status in ('pendente', 'interpretando', 'interpretado', 'erro', 'arquivado')),
  llm_result  jsonb,
  llm_model   text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
alter table public.events
  add constraint events_capture_fk foreign key (capture_id) references public.captures on delete set null;

-- Rotinas recorrentes (Fase 4). template = mesmo formato de tarefa da IA.
create table public.routines (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  title            text not null,
  rrule            text not null,          -- RFC 5545, ex.: FREQ=WEEKLY;BYDAY=WE
  template         jsonb not null,
  preferred_start  time,
  preferred_end    time,
  active           boolean not null default true,
  generated_until  date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  parent_id          uuid references public.tasks on delete cascade,
  seq                smallint not null default 0,      -- ordem entre subtarefas irmãs
  capture_id         uuid references public.captures on delete set null,
  routine_id         uuid references public.routines on delete set null,
  routine_date       date,                             -- ocorrência da rotina
  title              text not null,
  notes              text,
  category           text not null default 'pessoal'
                       check (category in ('pessoal', 'faculdade', 'tcc', 'empresa_junior', 'trabalho')),
  duration_min       integer not null check (duration_min > 0),
  actual_min         integer check (actual_min >= 0),
  earliest_start_at  timestamptz,
  deadline_at        timestamptz,
  deadline_hard      boolean not null default true,
  priority           smallint not null default 2 check (priority between 1 and 4),
  location_req       text not null default 'qualquer' check (location_req in ('casa', 'rua', 'qualquer')),
  region             text,                             -- só p/ 'rua': onde precisa ser (null = tanto faz)
  alert_mode         text check (alert_mode in ('nenhum', 'lembrete', 'alarme')),  -- null = padrão do perfil
  splittable         boolean not null default false,
  min_chunk_min      integer check (min_chunk_min > 0),
  is_cooking         boolean not null default false,
  inferred           boolean not null default false,   -- sugerida pela IA, não dita pelo usuário
  status             text not null default 'pendente'
                       check (status in ('inbox', 'pendente', 'agendada', 'em_andamento', 'concluida', 'cancelada')),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check (parent_id is null or parent_id <> id)
);
create index tasks_user_status on public.tasks (user_id, status);
create index tasks_parent on public.tasks (parent_id);
create unique index tasks_routine_occurrence on public.tasks (routine_id, routine_date)
  where routine_id is not null and parent_id is null;

-- Uma execução do agendador. Em modo "proposta" fica aguardando aprovação.
create table public.plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  reason         text not null check (reason in ('captura', 'checkin', 'manual', 'rotina', 'gcal')),
  status         text not null default 'proposta'
                   check (status in ('proposta', 'aprovada', 'descartada')),
  horizon_start  timestamptz not null,
  horizon_end    timestamptz not null,
  unplaced       jsonb not null default '[]',   -- [{task_id, reason}]
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  updated_at     timestamptz not null default now()
);

-- Horário concreto de uma tarefa (uma tarefa dividida tem vários blocos).
create table public.schedule_blocks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  task_id         uuid not null references public.tasks on delete cascade,
  plan_id         uuid references public.plans on delete set null,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  window_kind     text check (window_kind in ('casa', 'fora')),
  region          text,                             -- onde a janela acontece
  status          text not null default 'proposto'
                    check (status in ('proposto', 'confirmado', 'em_andamento', 'concluido', 'remarcado', 'cancelado')),
  locked          boolean not null default false,   -- movido à mão: o agendador não mexe
  gcal_event_id   text,
  gcal_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (end_at > start_at)
);
create index schedule_blocks_user_start on public.schedule_blocks (user_id, start_at);
create index schedule_blocks_task on public.schedule_blocks (task_id);

create table public.checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  block_id    uuid not null references public.schedule_blocks on delete cascade,
  moment      text not null check (moment in ('inicio', 'fim')),
  response    text check (response in ('terminei', 'mais_tempo', 'remarcar', 'ignorado')),
  extra_min   integer check (extra_min > 0),
  channel     text not null check (channel in ('android', 'web_push', 'tela')),
  created_at  timestamptz not null default now()
);
create index checkins_block on public.checkins (block_id);

-- ---------------------------------------------------------------------------
-- notificações
-- ---------------------------------------------------------------------------

-- Dispositivos: Android (notificação local) e navegadores (Web Push).
create table public.devices (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users on delete cascade,
  platform               text not null check (platform in ('android', 'web')),
  label                  text,
  notifications_enabled  boolean not null default true,
  push_endpoint          text unique,
  push_p256dh            text,
  push_auth              text,
  last_seen_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (platform <> 'web' or push_endpoint is not null)
);

-- Fila de Web Push (o Android agenda localmente e não usa esta tabela).
-- Gerada pelo servidor já respeitando silêncio e tipos ligados.
create table public.notification_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  block_id    uuid references public.schedule_blocks on delete cascade,
  kind        text not null check (kind in ('inicio', 'fim', 'proposta')),
  fire_at     timestamptz not null,
  status      text not null default 'agendada'
                check (status in ('agendada', 'enviada', 'cancelada', 'falhou')),
  attempts    smallint not null default 0,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (block_id, kind)
);
create index notification_jobs_due on public.notification_jobs (fire_at)
  where status = 'agendada';

-- ---------------------------------------------------------------------------
-- modo cozinha (Fase 4)
-- ---------------------------------------------------------------------------

create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  task_id       uuid references public.tasks on delete set null,
  title         text not null,
  servings      smallint check (servings > 0),
  prep_min      integer check (prep_min > 0),     -- vira a duração da tarefa "cozinhar"
  ingredients   jsonb not null default '[]',      -- [{name, qty, unit}]
  steps         jsonb not null default '[]',      -- [text]
  health_notes  text,
  chosen        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table public.shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  task_id     uuid references public.tasks on delete set null,  -- "comprar ingredientes"
  title       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.shopping_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  list_id     uuid not null references public.shopping_lists on delete cascade,
  name        text not null,
  qty         numeric,
  unit        text,
  section     text,                    -- hortifrúti, açougue, mercearia…
  recipe_ids  uuid[] not null default '{}',
  checked     boolean not null default false,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- uso da IA (teto diário para não sair do gratuito)
-- ---------------------------------------------------------------------------

create table public.llm_usage (
  id             bigint generated always as identity primary key,
  user_id        uuid references auth.users on delete set null,
  fn             text not null,          -- interpret, cook…
  provider       text not null,
  model          text not null,
  input_tokens   integer,
  output_tokens  integer,
  ok             boolean not null,
  error          text,
  created_at     timestamptz not null default now()
);
create index llm_usage_day on public.llm_usage (created_at);

-- ---------------------------------------------------------------------------
-- privado: credenciais e estado de sync do Google (só service role)
-- ---------------------------------------------------------------------------

create table private.google_credentials (
  user_id                  uuid primary key references auth.users on delete cascade,
  refresh_token_secret_id  uuid not null,   -- id do segredo no Supabase Vault
  scopes                   text[] not null default '{}',
  updated_at               timestamptz not null default now()
);

create table private.gcal_sync_state (
  user_id         uuid not null references auth.users on delete cascade,
  calendar_id     text not null,
  sync_token      text,
  last_synced_at  timestamptz,
  primary key (user_id, calendar_id)
);

-- ---------------------------------------------------------------------------
-- gatilhos
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'places', 'travel_times', 'fixed_commitments', 'events',
    'captures', 'routines', 'tasks', 'plans', 'schedule_blocks', 'devices',
    'recipes', 'shopping_lists', 'shopping_items'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Cria o perfil vazio no primeiro login; o onboarding preenche o resto.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS + GRANTs explícitos
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'places', 'travel_times', 'fixed_commitments', 'events',
    'captures', 'routines', 'tasks', 'plans', 'schedule_blocks', 'checkins',
    'devices', 'notification_jobs', 'recipes', 'shopping_lists',
    'shopping_items', 'llm_usage'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.profiles, public.places, public.travel_times, public.fixed_commitments,
  public.events, public.captures, public.routines, public.tasks, public.plans,
  public.schedule_blocks, public.checkins, public.devices, public.recipes,
  public.shopping_lists, public.shopping_items
to authenticated;

-- A fila de push e o uso da IA são escritos só pelas Edge Functions
-- (service role); o app apenas lê.
grant select on public.notification_jobs, public.llm_usage to authenticated;

grant all on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
