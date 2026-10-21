-- Toda ação pessoal passa a exigir uma sessão Google Workspace vinculada a
-- um servidor ativo. Consultas públicas de agenda e links tokenizados enviados
-- por e-mail continuam disponíveis sem autenticação.

revoke all on function public.identify_server(text) from public,anon,authenticated;
revoke all on function public.create_public_ticket(text,text,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.register_public_attachment(uuid,text,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.my_tickets(text) from public,anon,authenticated;
revoke all on function public.request_chat_session(text,text) from public,anon,authenticated;
revoke all on function public.create_public_reservation_range(text,uuid,text,timestamptz,timestamptz,text,text,date) from public,anon,authenticated;
revoke all on function public.request_reservation_access(text) from public,anon,authenticated;
revoke all on function public.submit_software_request(text,uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;

drop policy if exists storage_public_upload on storage.objects;
drop policy if exists storage_authenticated_ticket_upload on storage.objects;
create policy storage_authenticated_ticket_upload on storage.objects for insert to authenticated
with check(
  bucket_id='ticket-attachments'
  and (storage.foldername(name))[1]='tickets'
  and exists(
    select 1 from public.tickets t
    where t.id::text=(storage.foldername(name))[2]
      and (
        exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('tecnico','supervisor'))
        or exists(
          select 1 from public.servers s
          where s.id=t.server_id and s.active
            and lower(btrim(s.email))=lower(btrim(coalesce(auth.jwt()->>'email','')))
            and (
              coalesce(auth.jwt()->'app_metadata'->>'provider','')='google'
              or coalesce(auth.jwt()->'app_metadata'->'providers','[]'::jsonb) @> '["google"]'::jsonb
            )
        )
      )
  )
);

-- As funções acima são mantidas somente como implementação interna das RPCs
-- create_my_*, request_my_* e submit_my_*. Por serem SECURITY DEFINER, essas
-- wrappers continuam conseguindo chamá-las como proprietárias.
