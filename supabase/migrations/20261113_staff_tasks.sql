-- LABINFO exclusivamente. Quadro interno de tarefas; não altera chamados/reservas.
begin;
create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 2 and 160),
  description text not null default '' check(length(description)<=5000),
  status text not null default 'todo' check(status in ('todo','doing','done')),
  lab_id uuid references public.labs(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  assignee_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists staff_tasks_status_idx on public.staff_tasks(status,updated_at desc);
create index if not exists staff_tasks_assignee_idx on public.staff_tasks(assignee_id);
create table if not exists public.staff_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.staff_tasks(id),
  actor_id uuid references public.profiles(id),
  old_data jsonb,
  new_data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists staff_task_events_task_idx on public.staff_task_events(task_id,created_at desc);
alter table public.staff_tasks enable row level security;
alter table public.staff_task_events enable row level security;
revoke all on public.staff_tasks,public.staff_task_events from anon,authenticated;
grant select on public.staff_tasks,public.staff_task_events to authenticated;
drop policy if exists staff_tasks_read on public.staff_tasks;
create policy staff_tasks_read on public.staff_tasks for select to authenticated using(public.current_role()='tecnico');
drop policy if exists staff_task_events_read on public.staff_task_events;
create policy staff_task_events_read on public.staff_task_events for select to authenticated using(public.current_role()='tecnico');

create or replace function public.audit_staff_task()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.staff_task_events(task_id,actor_id,old_data,new_data)
    values(new.id,auth.uid(),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end $$;
revoke all on function public.audit_staff_task() from public,anon,authenticated;
drop trigger if exists staff_task_audit on public.staff_tasks;
create trigger staff_task_audit after insert or update on public.staff_tasks for each row execute function public.audit_staff_task();

create or replace function public.save_staff_task(
  p_id uuid,p_title text,p_description text,p_status text,p_lab uuid,p_ticket uuid,p_assignee uuid,p_version bigint
) returns public.staff_tasks
language plpgsql security definer set search_path=public as $$
declare previous public.staff_tasks; saved public.staff_tasks;
begin
  if auth.uid() is null or public.current_role() is distinct from 'tecnico' then raise exception 'Acesso exclusivo de técnicos ativos.'; end if;
  if p_status is null or p_status not in ('todo','doing','done') then raise exception 'Coluna inválida.'; end if;
  if length(btrim(coalesce(p_title,''))) not between 2 and 160 then raise exception 'Informe um título de 2 a 160 caracteres.'; end if;
  if length(coalesce(p_description,''))>5000 then raise exception 'Descrição limitada a 5.000 caracteres.'; end if;
  if p_id is not null then
    select t.* into previous from public.staff_tasks t where t.id=p_id for update;
    if previous.id is null then raise exception 'Tarefa não encontrada.'; end if;
    if p_version is distinct from previous.version then raise exception 'Outra pessoa atualizou esta tarefa. Atualize o quadro antes de salvar.'; end if;
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_assignee and p.active and p.role='tecnico')
    and (previous.id is null or p_assignee is distinct from previous.assignee_id) then raise exception 'Selecione um técnico ativo.'; end if;
  if p_assignee is null then raise exception 'Selecione o técnico responsável.'; end if;
  if p_lab is not null and not exists(select 1 from public.labs l where l.id=p_lab) then raise exception 'Laboratório não encontrado.'; end if;
  if p_ticket is not null and not exists(select 1 from public.tickets t where t.id=p_ticket) then raise exception 'Chamado não encontrado.'; end if;
  if p_id is null then
    insert into public.staff_tasks(title,description,status,lab_id,ticket_id,assignee_id,created_by,updated_by,completed_at)
      values(btrim(p_title),coalesce(p_description,''),p_status,p_lab,p_ticket,p_assignee,auth.uid(),auth.uid(),case when p_status='done' then now() end)
      returning * into saved;
  else
    update public.staff_tasks t set title=btrim(p_title),description=coalesce(p_description,''),status=p_status,
      lab_id=p_lab,ticket_id=p_ticket,assignee_id=p_assignee,updated_by=auth.uid(),updated_at=now(),version=t.version+1,
      completed_at=case when p_status='done' then coalesce(t.completed_at,now()) else null end
      where t.id=p_id returning t.* into saved;
  end if;
  return saved;
end $$;

create or replace function public.move_staff_task(p_id uuid,p_status text,p_version bigint)
returns public.staff_tasks language plpgsql security definer set search_path=public as $$
declare task public.staff_tasks;
begin
  if auth.uid() is null or public.current_role() is distinct from 'tecnico' then raise exception 'Acesso exclusivo de técnicos ativos.'; end if;
  select t.* into task from public.staff_tasks t where t.id=p_id for update;
  if task.id is null then raise exception 'Tarefa não encontrada.'; end if;
  return public.save_staff_task(task.id,task.title,task.description,p_status,task.lab_id,task.ticket_id,task.assignee_id,p_version);
end $$;
revoke all on function public.save_staff_task(uuid,text,text,text,uuid,uuid,uuid,bigint) from public,anon;
revoke all on function public.move_staff_task(uuid,text,bigint) from public,anon;
grant execute on function public.save_staff_task(uuid,text,text,text,uuid,uuid,uuid,bigint) to authenticated;
grant execute on function public.move_staff_task(uuid,text,bigint) to authenticated;
commit;
notify pgrst,'reload schema';
