-- LABINFO exclusivamente. Aplicar depois de 20261113_staff_tasks.sql.
begin;
alter table public.staff_tasks add column if not exists deleted_at timestamptz;
drop policy if exists staff_tasks_read on public.staff_tasks;
create policy staff_tasks_read on public.staff_tasks for select to authenticated
  using(public.current_role()='tecnico' and deleted_at is null);

create or replace function public.guard_deleted_staff_task()
returns trigger language plpgsql set search_path=public as $$
begin
  -- A limpeza de vínculos por FK continua funcionando mesmo após a exclusão.
  if old.deleted_at is not null and pg_trigger_depth()=1 then raise exception 'Esta tarefa foi excluída. Atualize o quadro.'; end if;
  return new;
end $$;
revoke all on function public.guard_deleted_staff_task() from public,anon,authenticated;
drop trigger if exists staff_task_deleted_guard on public.staff_tasks;
create trigger staff_task_deleted_guard before update on public.staff_tasks for each row execute function public.guard_deleted_staff_task();

create or replace function public.delete_staff_task(p_id uuid,p_version bigint)
returns void language plpgsql security definer set search_path=public as $$
declare task public.staff_tasks;
begin
  if auth.uid() is null or public.current_role() is distinct from 'tecnico' then raise exception 'Acesso exclusivo de técnicos ativos.'; end if;
  select t.* into task from public.staff_tasks t where t.id=p_id for update;
  if task.id is null or task.deleted_at is not null then raise exception 'Tarefa não encontrada ou já excluída.'; end if;
  if p_version is distinct from task.version then raise exception 'Outra pessoa atualizou esta tarefa. Atualize o quadro antes de excluir.'; end if;
  update public.staff_tasks t set deleted_at=now(),updated_at=now(),updated_by=auth.uid(),version=t.version+1 where t.id=p_id;
end $$;
revoke all on function public.delete_staff_task(uuid,bigint) from public,anon;
grant execute on function public.delete_staff_task(uuid,bigint) to authenticated;
commit;
notify pgrst,'reload schema';
