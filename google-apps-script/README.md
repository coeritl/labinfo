# Google Apps Script — LabInfo TL

O script consulta a caixa de entrada uma vez por hora e a fila de notificações do Supabase a cada minuto.

## Propriedades do script

Em **Configurações do projeto > Propriedades do script**, cadastre:

- `SUPABASE_URL`: `https://jvoeaqiusjivyofbyzvi.supabase.co`
- `SUPABASE_ANON_KEY`: chave pública (`anon`/`publishable`) do projeto
- `INTEGRATION_SECRET`: segredo aleatório cujo SHA-256 foi gravado no banco

Depois execute manualmente `configurarIntegracao` uma única vez e autorize Gmail, conexões externas e gatilhos. A função cria o marcador `LabInfo-Processado`, instala um gatilho horário para entradas, outro de um minuto para saídas e faz a primeira execução.

## Abertura por e-mail

- O remetente deve ser um e-mail `@ifms.edu.br` vinculado a um servidor ativo.
- Não é necessário usar prefixo ou palavra-chave no assunto.
- Para associar um laboratório automaticamente, inclua seu código no assunto.
- Exemplo: `LAB01 - Projetor sem imagem`.
- O corpo do e-mail será a descrição do chamado.

Somente remetentes que correspondam ao e-mail de um servidor ativo no painel geram chamados. Outros remetentes são ignorados. Mensagens processadas recebem o marcador `LabInfo-Processado`, o que impede duplicidade.
