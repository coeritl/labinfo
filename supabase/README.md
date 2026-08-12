# Configuração do Supabase

1. Crie um projeto gratuito no Supabase.
2. Abra **SQL Editor**, cole todo o conteúdo de `schema.sql` e execute.
3. Em **Authentication → Users**, crie os usuários dos técnicos e supervisores com e-mail e senha.
4. No SQL Editor, execute o `insert into public.profiles...` indicado no fim do arquivo para cada usuário.
5. Copie `config.example.js` para `supabase-config.js` na raiz do site e preencha a URL e a chave pública do projeto.
6. Para permitir que um técnico crie novos logins pelo painel, instale o Supabase CLI e execute:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy create-staff --no-verify-jwt
```

O próprio código da função valida o JWT e confirma que o solicitante possui perfil `tecnico` ativo. Técnicos e supervisores entram com e-mail e senha; apenas técnicos veem operações de alteração.

Nunca coloque a chave `service_role` no GitHub Pages. A chave pública/publishable é a única apropriada para o navegador; a segurança é aplicada pelas políticas RLS.
