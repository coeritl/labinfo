-- Histórico de disponibilidade do chat para relatórios operacionais.
-- Registra somente mudanças de estado; heartbeats que mantêm o mesmo estado
-- não geram linhas adicionais.

create table if not exists public.staff_chat_presence_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_online boolean not null,
  changed_at timestamptz not null default now()
);

create index if not exists staff_chat_presence_events_profile_time_idx
  on public.staff_chat_presence_events(profile_id, changed_at);

alter table public.staff_chat_presence_events enable row level security;

drop policy if exists staff_chat_presence_events_staff_read
  on public.staff_chat_presence_events;
create policy staff_chat_presence_events_staff_read
  on public.staff_chat_presence_events
  for select
  to authenticated
  using (public.current_role() in ('tecnico','supervisor'));

revoke all on table public.staff_chat_presence_events from anon;
revoke all on table public.staff_chat_presence_events from authenticated;
grant select on table public.staff_chat_presence_events to authenticated;

create or replace function public.log_staff_chat_presence_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or old.is_online is distinct from new.is_online then
    insert into public.staff_chat_presence_events(profile_id,is_online,changed_at)
    values(new.profile_id,new.is_online,now());
  end if;
  return new;
end;
$$;

revoke all on function public.log_staff_chat_presence_change() from public;
revoke all on function public.log_staff_chat_presence_change() from anon;
revoke all on function public.log_staff_chat_presence_change() from authenticated;

drop trigger if exists staff_chat_presence_change_log
  on public.staff_chat_status;
create trigger staff_chat_presence_change_log
after insert or update of is_online on public.staff_chat_status
for each row execute function public.log_staff_chat_presence_change();

-- Inicia o histórico com o estado atual, sem tentar reconstruir períodos
-- anteriores à instalação desta migração.
insert into public.staff_chat_presence_events(profile_id,is_online,changed_at)
select status.profile_id,status.is_online,now()
from public.staff_chat_status status
where not exists (
  select 1 from public.staff_chat_presence_events event
  where event.profile_id=status.profile_id
);
