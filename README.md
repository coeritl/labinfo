# LabInfo — Sistema de Chamados

Interface responsiva para abertura e gerenciamento de chamados dos Laboratórios de Informática do IFMS Campus Três Lagoas.

## Protótipo atual

- formulário servidor com validação de e-mail institucional;
- categorias e laboratórios;
- consulta por protocolo;
- painel técnico responsivo;
- indicadores, filtros, atribuição e resposta;
- dados demonstrativos para validação da experiência.

## Próxima etapa

Conectar a interface a um Google Apps Script para persistência em Planilhas Google, validação do cadastro servidor e envio de notificações por e-mail.

## Publicação

O site é estático e pode ser publicado diretamente pelo GitHub Pages a partir da raiz da branch `main`.

O cache-busting (`?v=...`) de `styles.css`, `app.js`, `supabase-integration.js` e `reservations.js` em `index.html` é atualizado automaticamente por `.github/workflows/cache-bust.yml` sempre que um desses arquivos muda em um push para `main` — não é mais necessário editar a query string manualmente. Para rodar a mesma atualização localmente antes de um deploy, use `node scripts/bump-cache-version.mjs` (não requer dependências).

## Testes

Há uma suíte básica de testes automatizados (sem dependências, usa `node:test`) em `tests/` — cobre os helpers de escape contra XSS e simula as permissões finais das migrations do Supabase para pegar cedo uma regressão parecida com os achados críticos já corrigidos. Rode com `npm test`. Roda automaticamente em cada push/PR (`.github/workflows/tests.yml`). Detalhes em `tests/README.md`.

## Riscos operacionais e continuidade (achado P1 2.2 da auditoria de 26/08/2026)

O sistema depende de dois serviços de terceiros no plano gratuito/individual, o que traz riscos de continuidade que a equipe deve conhecer e mitigar administrativamente (nenhum deles se resolve só com código):

### Supabase — plano gratuito

- Projetos gratuitos do Supabase entram em pausa automática após um período sem nenhuma requisição (histórico do produto: cerca de 7 dias consecutivos de inatividade). Um projeto pausado deixa o site, a abertura de chamados e o Apps Script fora do ar até alguém reativá-lo manualmente pelo painel do Supabase.
- Na prática, o próprio Apps Script já faz uma requisição ao banco a cada 1 minuto (fila de saída) e a cada 10 minutos (entrada de e-mail), o que mantém o projeto ativo continuamente enquanto os gatilhos estiverem rodando. Ou seja, o risco de pausa por inatividade hoje é baixo, mas é uma dependência implícita e frágil: se os gatilhos do Apps Script pararem de rodar (ver seção abaixo) por tempo suficiente, o Supabase também pode pausar, agravando o problema.
- Recomendações:
  - Cadastrar um lembrete recorrente (ex.: mensal) para verificar no painel do Supabase se o projeto segue ativo e dentro dos limites gratuitos de banco de dados, armazenamento e requisições.
  - Considerar migrar para um plano pago caso o uso real (chamados, reservas, anexos) se aproxime dos limites do plano gratuito — o painel do Supabase mostra o consumo atual.
  - Manter um backup periódico do banco (o Supabase permite exportar via `pg_dump`/painel) para o caso de perda de acesso ao projeto gratuito.

### Google Apps Script — conta única (bus factor)

- Toda a integração de e-mail (recebimento de chamados por e-mail, fila de notificações, confirmações de reserva) roda como um script vinculado a uma única conta Google (`labinfo.tl@ifms.edu.br`), com segredos guardados nas Propriedades do Script daquela conta.
- Isso é um ponto único de falha organizacional: se a pessoa responsável perder acesso à conta, sair da instituição sem repassar as credenciais, ou a conta for suspensa/bloqueada pelo Google, a integração de e-mail para completamente e ninguém mais consegue reimplantar o script sem recriar as propriedades (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INTEGRATION_SECRET`) do zero.
- Recomendações:
  - Garantir que a conta `labinfo.tl@ifms.edu.br` seja uma conta institucional (Google Workspace do IFMS), não uma conta pessoal, e que pelo menos duas pessoas da equipe técnica (ex.: o supervisor e um segundo técnico) tenham as credenciais de acesso, ou que a conta tenha um método de recuperação institucional administrado por mais de uma pessoa.
  - Guardar uma cópia segura (ex.: gerenciador de senhas da equipe, nunca em texto puro em chat ou planilha aberta) dos três valores de `SUPABASE_ANON_KEY`/`SUPABASE_URL`/`INTEGRATION_SECRET`, para permitir reimplantar o `Code.gs` em outra conta rapidamente se necessário.
  - Documentar, neste repositório ou em local acessível à equipe, o passo a passo de `google-apps-script/README.md` como runbook de recuperação.
