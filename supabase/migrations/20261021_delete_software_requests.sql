-- Permite que técnicos removam registros da campanha de softwares sem apagar
-- o chamado que já tenha sido criado a partir da confirmação institucional.

create or replace function public.staff_delete_software_request(p_request uuid)
returns table(status text, preserved_protocol text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.software_requests;
  v_protocol text;
begin
  if public.current_role() is distinct from 'tecnico'::public.app_role then
    raise exception 'Apenas técnicos podem excluir solicitações de software.';
  end if;

  select r.* into v_request
  from public.software_requests r
  where r.id=p_request
  for update;

  if v_request.id is null then
    raise exception 'Solicitação não localizada ou já excluída.';
  end if;

  if v_request.ticket_id is not null then
    select t.protocol into v_protocol
    from public.tickets t
    where t.id=v_request.ticket_id;
  end if;

  delete from public.software_requests where id=v_request.id;

  return query select v_request.status,v_protocol;
end;
$$;

revoke all on function public.staff_delete_software_request(uuid) from public,anon;
grant execute on function public.staff_delete_software_request(uuid) to authenticated;

