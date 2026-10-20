-- Campanhas semestrais para instalação/atualização de softwares.
-- A solicitação pública exige SIAPE ativo e confirmação no e-mail institucional
-- cadastrado. O chamado só é criado depois dessa confirmação.

create table if not exists public.software_request_cycles (
  id uuid primary key default gen_random_uuid(),
  semester_label text not null unique check (semester_label ~ '^[0-9]{4}/[12]$'),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  target_date date,
  instructions text,
  active boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at),
  check (length(coalesce(instructions,'')) <= 1200)
);

create unique index if not exists software_request_one_active_cycle
  on public.software_request_cycles(active) where active;

create table if not exists public.software_requests (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.software_request_cycles(id),
  server_id uuid not null references public.servers(id),
  lab_id uuid not null references public.labs(id),
  course_subject text not null check (length(course_subject) between 3 and 160),
  computer_scope text not null default 'all' check (computer_scope in ('all','specific')),
  machines text,
  items jsonb not null check (
    jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 30
  ),
  notes text,
  status text not null default 'awaiting_email'
    check (status in ('awaiting_email','confirmed','cancelled','expired')),
  confirmation_token_hash text not null unique,
  confirmation_expires_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  ticket_id uuid references public.tickets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (computer_scope='all' or length(btrim(coalesce(machines,''))) between 1 and 500),
  check (length(coalesce(notes,'')) <= 1200)
);

create index if not exists software_requests_cycle_status_idx
  on public.software_requests(cycle_id,status,created_at desc);
create index if not exists software_requests_server_idx
  on public.software_requests(server_id,created_at desc);

alter table public.software_request_cycles enable row level security;
alter table public.software_requests enable row level security;

drop policy if exists software_cycles_staff_read on public.software_request_cycles;
create policy software_cycles_staff_read on public.software_request_cycles
  for select to authenticated using (public.current_role() in ('tecnico','supervisor'));
drop policy if exists software_cycles_tech_write on public.software_request_cycles;
create policy software_cycles_tech_write on public.software_request_cycles
  for all to authenticated using (public.current_role()='tecnico')
  with check (public.current_role()='tecnico');
drop policy if exists software_requests_staff_read on public.software_requests;
create policy software_requests_staff_read on public.software_requests
  for select to authenticated using (public.current_role() in ('tecnico','supervisor'));

-- Mantém a lista fechada de eventos aceita pela fila de e-mails.
alter table public.email_outbox drop constraint if exists email_outbox_event_type_check;
alter table public.email_outbox add constraint email_outbox_event_type_check check(event_type in (
  'recebido','aberto_pelo_tecnico','em_atendimento','atualizacao','concluido',
  'novo_chamado_tecnico','resposta_servidor_tecnico','chat_aguardando_tecnico',
  'reserva_confirmar','reserva_confirmada','reserva_autorizada','reserva_cancelada','reserva_alterada',
  'reserva_acesso','reserva_cancelamento_confirmar',
  'reserva_cancelamento_aprovado','reserva_cancelamento_rejeitado',
  'software_solicitacao_confirmar'
));

create or replace function public.get_active_software_request_cycle()
returns table(
  id uuid, semester_label text, opens_at timestamptz, closes_at timestamptz,
  target_date date, instructions text
)
language sql stable security definer set search_path=public
as $$
  select c.id,c.semester_label,c.opens_at,c.closes_at,c.target_date,c.instructions
  from public.software_request_cycles c
  where c.active and now() between c.opens_at and c.closes_at
  order by c.opens_at desc limit 1
$$;

create or replace function public.submit_software_request(
  p_siape text,
  p_cycle uuid,
  p_lab uuid,
  p_course_subject text,
  p_computer_scope text,
  p_machines text,
  p_items jsonb,
  p_notes text default null
)
returns table(request_id uuid,status text)
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_server public.servers;
  v_cycle public.software_request_cycles;
  v_lab public.labs;
  v_request uuid;
  v_token uuid:=gen_random_uuid();
  v_expires timestamptz;
  v_item jsonb;
begin
  perform public.enforce_rate_limit('software_request',public.request_ip(),8,interval '1 hour');

  select s.* into v_server from public.servers s
  where s.siape=btrim(p_siape) and s.active limit 1;
  if v_server.id is null then raise exception 'SIAPE não localizado ou cadastro inativo.'; end if;

  select c.* into v_cycle from public.software_request_cycles c
  where c.id=p_cycle and c.active and now() between c.opens_at and c.closes_at;
  if v_cycle.id is null then raise exception 'Este período de solicitações não está aberto.'; end if;

  select l.* into v_lab from public.labs l where l.id=p_lab and l.active;
  if v_lab.id is null then raise exception 'Laboratório não localizado.'; end if;
  if length(btrim(coalesce(p_course_subject,''))) not between 3 and 160 then
    raise exception 'Informe a disciplina ou atividade.';
  end if;
  if p_computer_scope not in ('all','specific') then raise exception 'Selecione os computadores atendidos.'; end if;
  if p_computer_scope='specific' and length(btrim(coalesce(p_machines,''))) not between 1 and 500 then
    raise exception 'Informe os computadores específicos.';
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
  if length(coalesce(p_notes,''))>1200 then raise exception 'As observações devem ter até 1.200 caracteres.'; end if;

  -- O link nunca continua válido depois do encerramento da campanha.
  v_expires:=least(now()+interval '72 hours',v_cycle.closes_at);
  insert into public.software_requests(
    cycle_id,server_id,lab_id,course_subject,computer_scope,machines,items,notes,
    confirmation_token_hash,confirmation_expires_at
  ) values (
    v_cycle.id,v_server.id,v_lab.id,btrim(p_course_subject),p_computer_scope,
    case when p_computer_scope='specific' then btrim(p_machines) end,p_items,
    nullif(btrim(p_notes),''),encode(digest(v_token::text,'sha256'),'hex'),v_expires
  ) returning id into v_request;

  insert into public.email_outbox(recipient,event_type,payload)
  values(lower(v_server.email),'software_solicitacao_confirmar',jsonb_build_object(
    'server_name',v_server.full_name,
    'semester_label',v_cycle.semester_label,
    'lab',v_lab.name,
    'course_subject',btrim(p_course_subject),
    'computer_scope',p_computer_scope,
    'machines',case when p_computer_scope='specific' then btrim(p_machines) end,
    'items',p_items,
    'notes',nullif(btrim(p_notes),''),
    'confirmation_url','https://labinfo.tl.ifms.edu.br/reservas/?confirm_software_request='||v_token::text,
    'cancellation_url','https://labinfo.tl.ifms.edu.br/reservas/?cancel_software_request='||v_token::text
  ));
  return query select v_request,'awaiting_email'::text;
end $$;

create or replace function public.confirm_software_request(p_token uuid)
returns table(protocol text,status text)
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_request public.software_requests;
  v_cycle public.software_request_cycles;
  v_server public.servers;
  v_lab public.labs;
  v_category uuid;
  v_protocol text;
  v_ticket uuid;
  v_description text;
  v_items text;
begin
  update public.software_requests r set status='expired',updated_at=now()
  where r.status='awaiting_email' and r.confirmation_expires_at<now();

  select r.* into v_request from public.software_requests r
  where r.confirmation_token_hash=encode(digest(p_token::text,'sha256'),'hex') for update;
  if v_request.id is null then raise exception 'Link de confirmação inválido.'; end if;
  if v_request.status='expired' then raise exception 'Este link expirou. Faça uma nova solicitação durante o período aberto.'; end if;
  if v_request.status='cancelled' then raise exception 'Esta solicitação foi cancelada.'; end if;
  if v_request.status='confirmed' then
    return query select t.protocol,'confirmed'::text from public.tickets t where t.id=v_request.ticket_id;
    return;
  end if;

  select c.* into v_cycle from public.software_request_cycles c where c.id=v_request.cycle_id;
  select s.* into v_server from public.servers s where s.id=v_request.server_id;
  select l.* into v_lab from public.labs l where l.id=v_request.lab_id;
  select c.id into v_category from public.categories c
  where c.active and lower(c.name) like 'software%' order by c.name limit 1;
  if v_category is null then
    insert into public.categories(name,active) values('Software ou acesso',true)
    on conflict(name) do update set active=true returning id into v_category;
  end if;

  select string_agg(
    '• '||case when value->>'action'='update' then 'Atualizar' else 'Instalar' end||
    ': '||btrim(value->>'name')||
    case when nullif(btrim(coalesce(value->>'version','')),'') is not null then ' — versão '||btrim(value->>'version') else '' end||
    case when nullif(btrim(coalesce(value->>'official_url','')),'') is not null then E'\n  Link oficial: '||btrim(value->>'official_url') else '' end||
    case when nullif(btrim(coalesce(value->>'license_notes','')),'') is not null then E'\n  Licença/observação: '||btrim(value->>'license_notes') else '' end,
    E'\n'
  ) into v_items from jsonb_array_elements(v_request.items);

  v_description:='Solicitação confirmada pelo e-mail institucional para preparação do semestre '||v_cycle.semester_label||E'.\n\n'||
    'Disciplina/atividade: '||v_request.course_subject||E'\n'||
    'Laboratório: '||v_lab.name||E'\n'||
    'Computadores: '||case when v_request.computer_scope='all' then 'Todos do laboratório' else v_request.machines end||
    case when v_cycle.target_date is not null then E'\nPrazo desejado da campanha: '||to_char(v_cycle.target_date,'DD/MM/YYYY') else '' end||
    E'\n\nSoftwares solicitados:\n'||v_items||
    case when v_request.notes is not null then E'\n\nObservações do professor:\n'||v_request.notes else '' end;

  v_protocol:=public.next_protocol(v_request.lab_id);
  insert into public.tickets(protocol,server_id,lab_id,category_id,title,description,source)
  values(v_protocol,v_request.server_id,v_request.lab_id,v_category,
    left('['||v_cycle.semester_label||'] Preparação de software — '||v_request.course_subject,100),
    left(v_description,5000),'Formulario') returning id into v_ticket;

  update public.software_requests set status='confirmed',confirmed_at=now(),ticket_id=v_ticket,updated_at=now()
  where id=v_request.id;
  return query select v_protocol,'confirmed'::text;
end $$;

create or replace function public.cancel_software_request(p_token uuid)
returns table(status text)
language plpgsql security definer set search_path=public,extensions
as $$
declare v_request public.software_requests;
begin
  select r.* into v_request from public.software_requests r
  where r.confirmation_token_hash=encode(digest(p_token::text,'sha256'),'hex') for update;
  if v_request.id is null then raise exception 'Link de cancelamento inválido.'; end if;
  if v_request.status='confirmed' then raise exception 'A solicitação já foi confirmada e transformada em chamado.'; end if;
  if v_request.status='cancelled' then return query select 'cancelled'::text; return; end if;
  update public.software_requests set status='cancelled',cancelled_at=now(),updated_at=now()
  where id=v_request.id;
  return query select 'cancelled'::text;
end $$;

create or replace function public.staff_save_software_request_cycle(
  p_id uuid,
  p_semester_label text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_target_date date,
  p_instructions text,
  p_active boolean
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if public.current_role() is distinct from 'tecnico'::public.app_role then raise exception 'Apenas técnicos podem alterar campanhas.'; end if;
  if btrim(coalesce(p_semester_label,'')) !~ '^[0-9]{4}/[12]$' then raise exception 'Use o semestre no formato 2027/1.'; end if;
  if p_closes_at<=p_opens_at then raise exception 'O encerramento deve ser posterior à abertura.'; end if;
  if length(coalesce(p_instructions,''))>1200 then raise exception 'As orientações devem ter até 1.200 caracteres.'; end if;

  if p_active then
    update public.software_request_cycles set active=false,updated_at=now()
    where active and (p_id is null or id<>p_id);
  end if;
  if p_id is null then
    insert into public.software_request_cycles(
      semester_label,opens_at,closes_at,target_date,instructions,active,created_by
    ) values (
      btrim(p_semester_label),p_opens_at,p_closes_at,p_target_date,
      nullif(btrim(p_instructions),''),p_active,auth.uid()
    ) returning id into v_id;
  else
    update public.software_request_cycles set
      semester_label=btrim(p_semester_label),opens_at=p_opens_at,closes_at=p_closes_at,
      target_date=p_target_date,instructions=nullif(btrim(p_instructions),''),
      active=p_active,updated_at=now()
    where id=p_id returning id into v_id;
    if v_id is null then raise exception 'Campanha não localizada.'; end if;
  end if;
  return v_id;
end $$;

revoke all on function public.get_active_software_request_cycle() from public;
revoke all on function public.submit_software_request(text,uuid,uuid,text,text,text,jsonb,text) from public;
revoke all on function public.confirm_software_request(uuid) from public;
revoke all on function public.cancel_software_request(uuid) from public;
revoke all on function public.staff_save_software_request_cycle(uuid,text,timestamptz,timestamptz,date,text,boolean) from public;
grant execute on function public.get_active_software_request_cycle() to anon,authenticated;
grant execute on function public.submit_software_request(text,uuid,uuid,text,text,text,jsonb,text) to anon,authenticated;
grant execute on function public.confirm_software_request(uuid) to anon,authenticated;
grant execute on function public.cancel_software_request(uuid) to anon,authenticated;
grant execute on function public.staff_save_software_request_cycle(uuid,text,timestamptz,timestamptz,date,text,boolean) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.software_requests;
exception when duplicate_object then null; end $$;
