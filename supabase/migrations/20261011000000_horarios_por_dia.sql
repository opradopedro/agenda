-- Horários diferentes por dia e "sem horário fixo".
--   wake_time / sleep_time passam a ser a referência para dias sem horário fixo.
--   day_times: {"0": {"wake": "07:00" | null, "sleep": "00:00" | null}, …} (0 = domingo)
--   quiet_start null = o silêncio segue o horário de dormir/acordar de cada dia.
alter table public.profiles
  add column if not exists day_times jsonb not null default '{}',
  add column if not exists routine jsonb;          -- rascunho completo do onboarding

alter table public.profiles
  alter column wake_time set default '08:00',
  alter column quiet_start drop not null,
  alter column quiet_start set default null;

comment on column public.profiles.day_times is 'Acordar/dormir por dia da semana (0=domingo); null = sem horário fixo';
comment on column public.profiles.routine is 'Rotina do onboarding (estágio/faculdade por dia, lugares, deslocamentos)';
