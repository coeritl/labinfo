-- Autenticacao institucional com Google Workspace via Supabase Auth.
-- O SIAPE permanece como dado cadastral; a identidade publica passa a ser
-- derivada exclusivamente do JWT emitido pelo Supabase para o Google.

create or replace function public.current_ifms_server_id()
returns uuid
language plpgsql
stable
security definer
set search_path=public,auth
as $$
declare
  claims jsonb:=auth.jwt();
  login_email text:=lower(btrim(coalesce(claims->>'email','')));
  server_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre com sua conta institucional do Google.';
  end if;
  if split_part(login_email,'@',2)<>'ifms.edu.br' then
    raise exception 'Use uma conta institucional @ifms.edu.br.';
  end if;
  if not (
    coalesce(claims->'app_metadata'->>'provider','')='google'
    or coalesce(claims->'app_metadata'->'providers','[]'::jsonb) @> '["google"]'::jsonb
  ) then
    raise exception 'Esta operacao exige autenticacao pelo Google IFMS.';
  end if;

  select s.id into server_id
  from public.servers s
  where lower(btrim(s.email))=login_email and s.active
  limit 1;
  if server_id is null then
    raise exception 'Seu e-mail Google nao esta vinculado a um servidor ativo. Procure a equipe do LabInfo.';
  end if;
  return server_id;
end $$;

revoke all on function public.current_ifms_server_id() from public,anon,authenticated;

create or replace function public.get_my_ifms_identity()
returns table(id uuid,siape text,full_name text,email text)
language sql
stable
security definer
set search_path=public
as $$
  select s.id,s.siape,s.full_name,s.email
  from public.servers s
  where s.id=public.current_ifms_server_id()
$$;

create or replace function public.create_my_reservation_range(
  p_lab uuid,p_subject text,p_start timestamptz,p_end timestamptz,
  p_notes text default null,p_recurrence text default 'none',p_until date default null
)
returns table(id uuid,protocol text,status text)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  owner public.servers;
  created record;
  group_id uuid;
begin
  select s.* into owner from public.servers s where s.id=public.current_ifms_server_id();

  select * into created
  from public.create_public_reservation_range(
    owner.siape,p_lab,p_subject,p_start,p_end,p_notes,p_recurrence,p_until
  );

  select r.recurrence_group into group_id from public.reservations r where r.id=created.id;
  delete from public.email_outbox e
  where e.reservation_id=created.id and e.event_type='reserva_confirmar' and e.status='pending';
  update public.reservations r set
    status='Aguardando autorização',confirmed_at=coalesce(r.confirmed_at,now()),updated_at=now()
  where r.recurrence_group=group_id
    and r.server_id=owner.id
    and r.status='Aguardando confirmação';

  return query select created.id,created.protocol,'Aguardando autorização'::text;
end $$;

create or replace function public.list_my_reservations()
returns table(
  id uuid,protocol text,subject text,lab text,starts_at timestamptz,ends_at timestamptz,
  status text,recurrence text,recurrence_group uuid,occurrence_count bigint,request_pending boolean
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare owner_id uuid:=public.current_ifms_server_id();
begin
  return query
  select r.id,r.protocol,r.subject,l.name,r.starts_at,r.ends_at,r.status,r.recurrence,
    r.recurrence_group,
    count(*) over(partition by r.recurrence_group),
    exists(select 1 from public.reservation_cancellation_requests cr
      where cr.reservation_id=r.id and cr.status in ('awaiting_email','pending'))
  from public.reservations r
  join public.labs l on l.id=r.lab_id
  where r.server_id=owner_id
    and r.status in ('Aguardando autorização','Autorizada')
    and r.ends_at>now()
  order by r.starts_at;
end $$;

create or replace function public.request_my_reservation_cancellation(
  p_reservation uuid,p_scope text,p_reason text default null
)
returns table(protocol text,status text)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  owner_id uuid:=public.current_ifms_server_id();
  r public.reservations;
  placeholder uuid:=gen_random_uuid();
begin
  if p_scope not in ('occurrence','future','series') then
    raise exception 'Selecione o alcance do cancelamento.';
  end if;
  if length(btrim(coalesce(p_reason,'')))>500 then
    raise exception 'O motivo deve ter ate 500 caracteres.';
  end if;

  select reservation.* into r from public.reservations reservation
  where reservation.id=p_reservation and reservation.server_id=owner_id for update;
  if r.id is null then raise exception 'Reserva nao localizada.'; end if;
  if r.status not in ('Aguardando autorização','Autorizada') or r.ends_at<=now() then
    raise exception 'Esta reserva nao aceita solicitacao de cancelamento.';
  end if;
  update public.reservation_cancellation_requests cr set status='expired',updated_at=now()
  where cr.reservation_id=r.id and cr.status='awaiting_email' and cr.confirmation_expires_at<now();
  if exists(select 1 from public.reservation_cancellation_requests cr
    where cr.reservation_id=r.id and cr.status in ('awaiting_email','pending')) then
    raise exception 'Ja existe uma solicitacao de cancelamento em andamento para esta reserva.';
  end if;

  insert into public.reservation_cancellation_requests(
    reservation_id,server_id,scope,reason,status,confirmation_token_hash,
    confirmation_expires_at,email_confirmed_at
  ) values (
    r.id,owner_id,p_scope,nullif(btrim(p_reason),''),'pending',
    encode(digest(placeholder::text,'sha256'),'hex'),now(),now()
  );
  return query select r.protocol,'pending'::text;
end $$;

create or replace function public.submit_my_software_request(
  p_cycle uuid,
  p_lab uuid,
  p_course_subject text,
  p_computer_scope text,
  p_machines text,
  p_items jsonb,
  p_notes text default null
)
returns table(request_id uuid,protocol text,status text)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_server public.servers;
  v_cycle public.software_request_cycles;
  v_lab public.labs;
  v_request uuid;
  v_category uuid;
  v_ticket uuid;
  v_protocol text;
  v_item jsonb;
  v_items text;
  v_description text;
  v_placeholder uuid:=gen_random_uuid();
begin
  perform public.enforce_rate_limit('software_request_authenticated',public.request_ip(),12,interval '1 hour');
  select s.* into v_server from public.servers s where s.id=public.current_ifms_server_id();
  select c.* into v_cycle from public.software_request_cycles c
  where c.id=p_cycle and c.active and now() between c.opens_at and c.closes_at;
  if v_cycle.id is null then raise exception 'Este periodo de solicitacoes nao esta aberto.'; end if;
  select l.* into v_lab from public.labs l where l.id=p_lab and l.active;
  if v_lab.id is null then raise exception 'Laboratorio nao localizado.'; end if;
  if length(btrim(coalesce(p_course_subject,''))) not between 3 and 160 then
    raise exception 'Informe a disciplina ou atividade.';
  end if;
  if p_computer_scope not in ('all','specific') then raise exception 'Selecione os computadores atendidos.'; end if;
  if p_computer_scope='specific' and length(btrim(coalesce(p_machines,''))) not between 1 and 500 then
    raise exception 'Informe os computadores especificos.';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Informe de 1 a 30 softwares.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'action','') not in ('install','update')
      or length(btrim(coalesce(v_item->>'name',''))) not between 2 and 120
      or length(coalesce(v_item->>'version',''))>60
      or length(coalesce(v_item->>'official_url',''))>400
      or length(coalesce(v_item->>'license_notes',''))>500 then
      raise exception 'Revise os dados dos softwares informados.';
    end if;
  end loop;
  if length(coalesce(p_notes,''))>1200 then raise exception 'As observacoes devem ter ate 1.200 caracteres.'; end if;

  select c.id into v_category from public.categories c
  where c.active and lower(c.name) like 'software%' order by c.name limit 1;
  if v_category is null then
    insert into public.categories(name,active) values('Software ou acesso',true)
    on conflict(name) do update set active=true returning id into v_category;
  end if;

  select string_agg(
    '• '||case when value->>'action'='update' then 'Atualizar' else 'Instalar' end||
    ': '||btrim(value->>'name')||
    case when nullif(btrim(coalesce(value->>'version','')),'') is not null then ' — versao '||btrim(value->>'version') else '' end||
    case when nullif(btrim(coalesce(value->>'official_url','')),'') is not null then E'\n  Link oficial: '||btrim(value->>'official_url') else '' end||
    case when nullif(btrim(coalesce(value->>'license_notes','')),'') is not null then E'\n  Licenca/observacao: '||btrim(value->>'license_notes') else '' end,
    E'\n'
  ) into v_items from jsonb_array_elements(p_items);

  v_description:='Solicitacao autenticada pelo Google IFMS para preparacao do semestre '||v_cycle.semester_label||E'.\n\n'||
    'Disciplina/atividade: '||btrim(p_course_subject)||E'\n'||
    'Laboratorio: '||v_lab.name||E'\n'||
    'Computadores: '||case when p_computer_scope='all' then 'Todos do laboratorio' else btrim(p_machines) end||
    case when v_cycle.target_date is not null then E'\nPrazo desejado da campanha: '||to_char(v_cycle.target_date,'DD/MM/YYYY') else '' end||
    E'\n\nSoftwares solicitados:\n'||v_items||
    case when nullif(btrim(coalesce(p_notes,'')),'') is not null then E'\n\nObservacoes do professor:\n'||btrim(p_notes) else '' end;

  v_protocol:=public.next_protocol(v_lab.id);
  insert into public.tickets(protocol,server_id,lab_id,category_id,title,description,source)
  values(v_protocol,v_server.id,v_lab.id,v_category,
    left('['||v_cycle.semester_label||'] Preparacao de software — '||btrim(p_course_subject),100),
    left(v_description,5000),'Formulario') returning id into v_ticket;

  insert into public.software_requests(
    cycle_id,server_id,lab_id,course_subject,computer_scope,machines,items,notes,status,
    confirmation_token_hash,confirmation_expires_at,confirmed_at,ticket_id
  ) values (
    v_cycle.id,v_server.id,v_lab.id,btrim(p_course_subject),p_computer_scope,
    case when p_computer_scope='specific' then btrim(p_machines) end,p_items,
    nullif(btrim(p_notes),''),'confirmed',encode(digest(v_placeholder::text,'sha256'),'hex'),
    now(),now(),v_ticket
  ) returning id into v_request;

  return query select v_request,v_protocol,'confirmed'::text;
end $$;

revoke all on function public.get_my_ifms_identity() from public;
revoke all on function public.create_my_reservation_range(uuid,text,timestamptz,timestamptz,text,text,date) from public;
revoke all on function public.list_my_reservations() from public;
revoke all on function public.request_my_reservation_cancellation(uuid,text,text) from public;
revoke all on function public.submit_my_software_request(uuid,uuid,text,text,text,jsonb,text) from public;

grant execute on function public.get_my_ifms_identity() to authenticated;
grant execute on function public.create_my_reservation_range(uuid,text,timestamptz,timestamptz,text,text,date) to authenticated;
grant execute on function public.list_my_reservations() to authenticated;
grant execute on function public.request_my_reservation_cancellation(uuid,text,text) to authenticated;
grant execute on function public.submit_my_software_request(uuid,uuid,text,text,text,jsonb,text) to authenticated;
