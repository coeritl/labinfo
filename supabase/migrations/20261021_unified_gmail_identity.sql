-- Amplia a identidade institucional do Google Workspace para chamados e chat.
-- O navegador deixa de enviar SIAPE/e-mail como fonte de autoridade: ambos são
-- derivados do JWT Google e do cadastro ativo em public.servers.

create or replace function public.create_my_ticket(
  p_lab uuid,p_category uuid,p_title text,p_description text
)
returns table(id uuid,protocol text)
language plpgsql
security definer
set search_path=public
as $$
declare owner public.servers;
begin
  select s.* into owner from public.servers s where s.id=public.current_ifms_server_id();
  return query select * from public.create_public_ticket(
    owner.siape,owner.email,p_lab,p_category,p_title,p_description
  );
end $$;

create or replace function public.register_my_ticket_attachment(
  p_ticket uuid,p_path text,p_name text,p_type text,p_size bigint
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare owner_id uuid:=public.current_ifms_server_id();
begin
  if not exists(
    select 1 from public.tickets t
    where t.id=p_ticket and t.server_id=owner_id and t.status<>'Concluído'
  ) then raise exception 'Chamado inválido para esta conta institucional'; end if;
  if (select count(*) from public.attachments where ticket_id=p_ticket)>=3 then
    raise exception 'Limite de anexos';
  end if;
  insert into public.attachments(ticket_id,storage_path,file_name,mime_type,size_bytes)
  values(p_ticket,p_path,left(p_name,180),p_type,p_size);
end $$;

create or replace function public.my_tickets_authenticated()
returns table(
  protocol text,title text,category text,lab text,status public.ticket_status,
  technician text,resolution text,created_at timestamptz,updated_at timestamptz,timeline jsonb
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare owner public.servers;
begin
  select s.* into owner from public.servers s where s.id=public.current_ifms_server_id();
  return query select * from public.my_tickets(owner.siape);
end $$;

create or replace function public.request_my_chat_session(p_subject text)
returns table(session_id uuid,server_id uuid,server_name text,server_email text,status text)
language plpgsql
security definer
set search_path=public
as $$
declare owner public.servers;
begin
  select s.* into owner from public.servers s where s.id=public.current_ifms_server_id();
  return query select * from public.request_chat_session(owner.siape,p_subject);
end $$;

revoke all on function public.create_my_ticket(uuid,uuid,text,text) from public,anon;
revoke all on function public.register_my_ticket_attachment(uuid,text,text,text,bigint) from public,anon;
revoke all on function public.my_tickets_authenticated() from public,anon;
revoke all on function public.request_my_chat_session(text) from public,anon;
grant execute on function public.create_my_ticket(uuid,uuid,text,text) to authenticated;
grant execute on function public.register_my_ticket_attachment(uuid,text,text,text,bigint) to authenticated;
grant execute on function public.my_tickets_authenticated() to authenticated;
grant execute on function public.request_my_chat_session(text) to authenticated;
