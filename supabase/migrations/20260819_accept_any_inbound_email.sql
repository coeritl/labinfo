-- Aceita chamados enviados diretamente ao Gmail por remetentes não cadastrados.
-- O fluxo público do portal e sua validação por SIAPE permanecem inalterados.
alter table public.tickets drop constraint if exists tickets_server_identity_check;
alter table public.tickets add constraint tickets_server_identity_check check (
  server_id is not null or (
    lower(guest_email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and (guest_siape is null or guest_siape ~ '^[0-9]{5,12}$')
  )
);

alter table public.email_outbox drop constraint if exists email_outbox_recipient_check;
alter table public.email_outbox add constraint email_outbox_recipient_check
check (lower(recipient) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');

create or replace function public.ticket_email_payload(t public.tickets)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'protocol',t.protocol,'title',t.title,'description',t.description,'status',t.status,
    'server_name',coalesce(s.full_name,t.guest_email,'Remetente por e-mail'),
    'lab',coalesce(l.name,'Não informado'),'category',coalesce(c.name,'Não informada'),
    'created_at',t.created_at,'portal_url','https://coeritl.github.io/labinfo/suporte/'
  )
  from (select 1) x left join public.servers s on s.id=t.server_id
  left join public.labs l on l.id=t.lab_id left join public.categories c on c.id=t.category_id
$$;

create or replace function public.apps_script_register_inbound(
  p_secret text,p_message_id text,p_sender text,p_subject text,p_body text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_server public.servers; v_lab uuid; v_title text; v_protocol text;
  v_ticket uuid; v_existing public.tickets; v_sender text:=lower(btrim(p_sender));
begin
  if not public.integration_secret_valid(p_secret) then raise exception 'Credencial inválida'; end if;
  if exists(select 1 from public.email_inbox_log where gmail_message_id=p_message_id and result<>'remetente_nao_cadastrado') then return jsonb_build_object('duplicate',true); end if;
  delete from public.email_inbox_log where gmail_message_id=p_message_id and result='remetente_nao_cadastrado';
  if length(v_sender)>254 or v_sender !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    insert into public.email_inbox_log values(p_message_id,v_sender,left(coalesce(p_subject,''),300),null,'remetente_invalido',now());
    return jsonb_build_object('accepted',false,'reason','remetente_invalido');
  end if;
  select * into v_server from public.servers where lower(email)=v_sender and active limit 1;
  v_protocol:=(regexp_match(upper(coalesce(p_subject,'')),'(LAB[0-9]*-[0-9]+)'))[1];
  if v_protocol is not null then
    select t.* into v_existing from public.tickets t left join public.servers s on s.id=t.server_id
    where t.protocol=v_protocol and t.deleted_at is null and lower(coalesce(s.email,t.guest_email))=v_sender limit 1;
  end if;
  if v_existing.id is not null then
    insert into public.ticket_updates(ticket_id,author_id,message,kind,visible_to_server)
    values(v_existing.id,null,left(btrim(p_body),2000),'resposta_servidor',true);
    insert into public.email_inbox_log values(p_message_id,v_sender,left(coalesce(p_subject,''),300),v_existing.id,'resposta_adicionada',now());
    return jsonb_build_object('accepted',true,'reply',true,'ticket_id',v_existing.id,'protocol',v_existing.protocol,'siape',v_server.siape,'guest_email',v_sender);
  end if;
  if (select count(*) from public.tickets t left join public.servers s on s.id=t.server_id where lower(coalesce(s.email,t.guest_email))=v_sender and t.created_at>now()-interval '1 hour')>=10 then raise exception 'Limite de chamados por remetente atingido. Tente novamente mais tarde.'; end if;
  if (select count(*) from public.tickets t left join public.servers s on s.id=t.server_id where lower(coalesce(s.email,t.guest_email))=v_sender and t.created_at>now()-interval '1 day')>=30 then raise exception 'Limite diário de chamados por remetente atingido.'; end if;
  select id into v_lab from public.labs where active and code is not null and upper(coalesce(p_subject,'')) like '%'||upper(code)||'%' order by length(code) desc limit 1;
  v_title:=btrim(regexp_replace(coalesce(p_subject,''),'^\s*CHAMADO\s*:\s*','', 'i')); if v_title='' then v_title:='Chamado recebido por e-mail'; end if;
  v_protocol:=public.next_protocol(v_lab);
  insert into public.tickets(protocol,server_id,guest_siape,guest_email,lab_id,title,description,source)
  values(v_protocol,v_server.id,null,case when v_server.id is null then v_sender end,v_lab,left(v_title,100),left(btrim(coalesce(p_body,'')),2000),'Email') returning id into v_ticket;
  insert into public.email_inbox_log values(p_message_id,v_sender,left(coalesce(p_subject,''),300),v_ticket,'criado',now());
  return jsonb_build_object('accepted',true,'reply',false,'ticket_id',v_ticket,'protocol',v_protocol,'siape',v_server.siape,'guest_email',v_sender);
end $$;

create or replace function public.apps_script_register_attachment(
  p_secret text,p_ticket uuid,p_path text,p_name text,p_type text,p_size bigint
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.integration_secret_valid(p_secret) then raise exception 'Credencial inválida'; end if;
  if not exists(select 1 from public.tickets where id=p_ticket and status<>'Concluído' and deleted_at is null) then raise exception 'Chamado inválido'; end if;
  if p_type not in ('image/jpeg','image/png','image/webp') or p_size<=0 or p_size>5242880 then raise exception 'Imagem inválida'; end if;
  if (select count(*) from public.attachments where ticket_id=p_ticket)>=3 then raise exception 'Limite de anexos'; end if;
  insert into public.attachments(ticket_id,storage_path,file_name,mime_type,size_bytes) values(p_ticket,p_path,left(p_name,180),p_type,p_size);
end $$;
revoke all on function public.apps_script_register_attachment(text,uuid,text,text,text,bigint) from public;
grant execute on function public.apps_script_register_attachment(text,uuid,text,text,text,bigint) to anon,authenticated;

create or replace function public.link_pending_server_tickets() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.active then
    update public.tickets set server_id=new.id,guest_siape=null,guest_email=null,updated_at=now()
    where server_id is null and ((guest_siape is not null and guest_siape=new.siape) or lower(guest_email)=lower(new.email));
  end if;
  return new;
end $$;
