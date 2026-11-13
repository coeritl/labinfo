# Tarefas — LabInfo

Execute `supabase/migrations/20261113_staff_tasks.sql` **apenas no Supabase do
LabInfo**. Não executar no SIGLAB. A migração adiciona tabelas e RPCs próprias;
não altera chamados, reservas, perfis ou notificações existentes.

O quadro aparece ao lado da fila de atendimento no desktop e abaixo dela em
telas menores. O menu **Tarefas** e o botão **Expandir** abrem o quadro inteiro
em `/admin/tarefas/`.

- Colunas A fazer, Fazendo e Concluído; mover arrastando ou pelo seletor do cartão.
- Clique no cartão para editar título, descrição, coluna, responsável e vínculos.
- Técnico responsável obrigatório, preenchido inicialmente com o usuário atual.
- Laboratório e chamado opcionais. Busque o chamado pelo protocolo.
- Todos os técnicos ativos compartilham o quadro. Visitantes, servidores comuns
  e supervisores não têm acesso. A restrição também é aplicada no banco.
- Histórico guarda autor, data e valores anteriores/novos de cada alteração.
- Concluir tarefa não conclui o chamado vinculado e não envia e-mail.
- Atualização manual e automática a cada minuto quando o quadro está visível.
  Edições concorrentes são rejeitadas pelo número de versão; fechar o editor e
  atualizar o quadro antes de editar novamente. Não há sobrescrita silenciosa.
- Não há exclusão de tarefas nesta primeira versão; conclusão mantém o histórico.

## Validação após aplicar SQL

1. Entre como técnico, crie uma tarefa e confira em outra sessão técnica.
2. Edite descrição, escolha laboratório e busque um protocolo existente.
3. Mova por seletor e arraste entre as três colunas; confira o histórico.
4. Confira o seletor no celular e o acesso pelo link direto.
5. Abra a mesma tarefa em duas sessões: uma edição antiga deve ser rejeitada.

Os testes locais de interface usam dados fictícios. A gravação real depende da
migração e deve ser validada após aplicação. Se a tabela ainda não existir,
somente o quadro mostra um aviso de ativação; a fila de chamados segue normal.
