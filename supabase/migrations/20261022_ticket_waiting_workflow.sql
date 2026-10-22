-- Estado operacional para chamados que dependem de prazo, retorno ou preparação.
-- Mantém separado o tempo efetivamente trabalhado do período de espera.

do $$
begin
  alter type public.ticket_status add value 'Aguardando' after 'Em atendimento';
exception when duplicate_object then null;
end $$;

alter table public.tickets
  add column if not exists waiting_reason text,
  add column if not exists waiting_note text,
  add column if not exists waiting_review_on date,
  add column if not exists waiting_started_at timestamptz,
  add column if not exists waiting_total_seconds bigint not null default 0;

alter table public.tickets drop constraint if exists tickets_waiting_reason_check;
alter table public.tickets add constraint tickets_waiting_reason_check check (
  waiting_reason is null or waiting_reason in (
    'retorno_solicitante','disponibilidade_laboratorio','preparacao_laboratorio',
    'recurso','suporte_terceiro','agendamento','outro'
  )
);
alter table public.tickets drop constraint if exists tickets_waiting_total_seconds_check;
alter table public.tickets add constraint tickets_waiting_total_seconds_check
  check (waiting_total_seconds >= 0);

create or replace function public.staff_wait_ticket(
  p_ticket uuid,p_reason text,p_note text,p_review_on date
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  t public.tickets;
  actor uuid:=auth.uid();
  changed_at timestamptz:=now();
  reason_label text;
  update_message text;
begin
  if actor is null or public.current_role()<>'tecnico' then raise exception 'Acesso negado.'; end if;
  if p_reason not in ('retorno_solicitante','disponibilidade_laboratorio','preparacao_laboratorio','recurso','suporte_terceiro','agendamento','outro') then
    raise exception 'Selecione um motivo válido para a espera.';
  end if;
  if length(btrim(coalesce(p_note,'')))<5 then raise exception 'Explique a pendência com pelo menos 5 caracteres.'; end if;
  if p_review_on is null or p_review_on<current_date then raise exception 'Informe uma data de revisão válida.'; end if;

  select * into t from public.tickets where id=p_ticket for update;
  if t.id is null or t.deleted_at is not null then raise exception 'Chamado não localizado.'; end if;
  if t.status='Concluído' then raise exception 'Um chamado concluído não pode ser colocado em espera.'; end if;
  if t.category_id is null then raise exception 'Informe a categoria antes de colocar o chamado em espera.'; end if;

  reason_label:=case p_reason
    when 'retorno_solicitante' then 'Retorno do solicitante'
    when 'disponibilidade_laboratorio' then 'Disponibilidade do laboratório'
    when 'preparacao_laboratorio' then 'Preparação do laboratório'
    when 'recurso' then 'Instalação ou aquisição de recurso'
    when 'suporte_terceiro' then 'Suporte de terceiro'
    when 'agendamento' then 'Atendimento agendado'
    else 'Outro motivo'
  end;

  insert into public.ticket_assignees(ticket_id,profile_id,assigned_by)
  values(t.id,actor,actor) on conflict(ticket_id,profile_id) do nothing;

  update public.tickets set
    assigned_to=coalesce(assigned_to,actor),
    status='Aguardando',
    started_at=coalesce(started_at,changed_at),
    waiting_reason=p_reason,
    waiting_note=btrim(p_note),
    waiting_review_on=p_review_on,
    waiting_started_at=case when t.status='Aguardando' then coalesce(t.waiting_started_at,changed_at) else changed_at end,
    updated_at=changed_at
  where id=t.id;

  update_message:=case when t.status='Aguardando' then 'Período de espera atualizado. ' else 'Chamado colocado em espera. ' end
    ||'Motivo: '||reason_label||'. '||btrim(p_note)||' Revisão prevista para '
    ||to_char(p_review_on,'DD/MM/YYYY')||'.';
  insert into public.ticket_updates(ticket_id,author_id,message,kind,visible_to_server)
  values(t.id,actor,update_message,'atualizacao',true);

  return jsonb_build_object('protocol',t.protocol,'status','Aguardando','reason',p_reason,'review_on',p_review_on);
end $$;

create or replace function public.staff_resume_ticket(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.tickets; actor uuid:=auth.uid(); changed_at timestamptz:=now();
begin
  if actor is null or public.current_role()<>'tecnico' then raise exception 'Acesso negado.'; end if;
  select * into t from public.tickets where id=p_ticket for update;
  if t.id is null or t.deleted_at is not null then raise exception 'Chamado não localizado.'; end if;
  if t.status<>'Aguardando' then raise exception 'Este chamado não está aguardando.'; end if;

  update public.tickets set
    status='Em atendimento',
    waiting_total_seconds=waiting_total_seconds+greatest(0,extract(epoch from (changed_at-coalesce(waiting_started_at,changed_at)))::bigint),
    waiting_reason=null,waiting_note=null,waiting_review_on=null,waiting_started_at=null,
    updated_at=changed_at
  where id=t.id;
  insert into public.ticket_updates(ticket_id,author_id,message,kind,visible_to_server)
  values(t.id,actor,'Atendimento retomado pela equipe técnica.','status',true);
  return jsonb_build_object('protocol',t.protocol,'status','Em atendimento');
end $$;

-- A conclusão direta também encerra e contabiliza uma espera que esteja aberta.
create or replace function public.staff_complete_ticket(
  p_ticket uuid,p_resolution text,p_direct boolean default false
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare t public.tickets; actor uuid:=auth.uid(); closed_time timestamptz:=now();
begin
  if actor is null or public.current_role()<>'tecnico' then raise exception 'Acesso negado.'; end if;
  if length(btrim(coalesce(p_resolution,'')))<5 then raise exception 'Descreva a solução realizada.'; end if;
  select * into t from public.tickets where id=p_ticket for update;
  if t.id is null or t.deleted_at is not null then raise exception 'Chamado não localizado.'; end if;
  if t.status='Concluído' then raise exception 'Este chamado já foi concluído.'; end if;
  if t.category_id is null then raise exception 'Informe a categoria antes de concluir o chamado.'; end if;

  insert into public.ticket_assignees(ticket_id,profile_id,assigned_by)
  values(t.id,actor,actor) on conflict(ticket_id,profile_id) do nothing;
  update public.tickets set
    assigned_to=coalesce(assigned_to,actor),status='Concluído',
    resolution=btrim(p_resolution),started_at=coalesce(started_at,closed_time),closed_at=closed_time,
    waiting_total_seconds=waiting_total_seconds+case when t.status='Aguardando' then greatest(0,extract(epoch from (closed_time-coalesce(waiting_started_at,closed_time)))::bigint) else 0 end,
    waiting_reason=null,waiting_note=null,waiting_review_on=null,waiting_started_at=null,
    server_reply_pending=false,updated_at=closed_time
  where id=t.id;
  insert into public.ticket_updates(ticket_id,author_id,message,kind)
  values(t.id,actor,btrim(p_resolution),'fechamento');
  return jsonb_build_object('protocol',t.protocol,'status','Concluído','direct',coalesce(p_direct,false));
end $$;

revoke all on function public.staff_wait_ticket(uuid,text,text,date) from public,anon;
revoke all on function public.staff_resume_ticket(uuid) from public,anon;
revoke all on function public.staff_complete_ticket(uuid,text,boolean) from public,anon;
grant execute on function public.staff_wait_ticket(uuid,text,text,date) to authenticated;
grant execute on function public.staff_resume_ticket(uuid) to authenticated;
grant execute on function public.staff_complete_ticket(uuid,text,boolean) to authenticated;

