import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('../staff-tasks.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261113_staff_tasks.sql',import.meta.url),'utf8');
const context={window:{}};vm.runInNewContext(js,context);
test('tarefas filtra título e descrição sem acentos, e responsável',()=>{
  const rows=[{title:'Preparação do laboratório',description:'Conferir software',assignee_id:'a'},{title:'Projetor',description:'Conexão HDMI',assignee_id:'b'}];
  assert.equal(context.window.labinfoTasks.filterTasks(rows,'preparacao','').length,1);
  assert.equal(context.window.labinfoTasks.filterTasks(rows,'conexao','b').length,1);
  assert.equal(context.window.labinfoTasks.filterTasks(rows,'','a').length,1);
});
test('gravação e leitura são exclusivas dos técnicos autenticados',()=>{
  assert.match(sql,/alter table public.staff_tasks enable row level security/);
  assert.match(sql,/revoke all on public.staff_tasks,public.staff_task_events from anon,authenticated/);
  assert.equal((sql.match(/auth.uid\(\) is null or public.current_role\(\) is distinct from 'tecnico'/g)||[]).length,2);
  assert.match(sql,/grant execute on function public.move_staff_task\(uuid,text,bigint\) to authenticated/);
  assert.match(sql,/using\(public.current_role\(\)='tecnico'\)/);
});
test('tarefas validam vínculos, status e versão e registram auditoria',()=>{
  assert.match(sql,/p_status not in \('todo','doing','done'\)/);
  assert.match(sql,/p_version is distinct from previous.version/);
  assert.match(sql,/where t.id=p_id for update/);
  assert.match(sql,/p.id=p_assignee and p.active and p.role='tecnico'/);
  assert.match(sql,/t.id=p_ticket/);
  assert.match(sql,/after insert or update on public.staff_tasks/);
  assert.match(sql,/completed_at=case when p_status='done'/);
  assert.doesNotMatch(sql,/update public.tickets|insert into public.email_outbox/);
});
test('interface oferece arrastar, seletor, edição e proteção de HTML',()=>{
  assert.match(js,/ondragstart/);assert.match(js,/ondrop/);
  assert.match(js,/data-move-task/);assert.match(js,/esc\(task.title\)/);
  assert.match(js,/p_version:task.version/);assert.match(js,/p_version:editing\?\.version/);
  assert.match(js,/dialog.showModal\(\)/);
});
test('rota do painel e quadro dividido preservam chamados',()=>{
  const integration=fs.readFileSync(new URL('../supabase-integration.js',import.meta.url),'utf8');
  assert.match(integration,/tasksMenuButton:'tarefas'/);
  assert.match(integration,/window.labinfoTasks.dock\(state.profile\)/);
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(html.indexOf('staff-tasks.js')<html.indexOf('src="supabase-integration.js'));
});
test('exclusão é lógica, autenticada, versionada e auditada',()=>{
  const migration=fs.readFileSync(new URL('../supabase/migrations/20261113_staff_tasks_delete.sql',import.meta.url),'utf8');
  assert.match(migration,/public.current_role\(\) is distinct from 'tecnico'/);
  assert.match(migration,/p_version is distinct from task.version/);
  assert.match(migration,/set deleted_at=now\(\)/);
  assert.match(migration,/deleted_at is null/);
  assert.match(migration,/revoke all on function public.delete_staff_task\(uuid,bigint\) from public,anon/);
  assert.doesNotMatch(migration,/delete from public.staff_tasks/i);
  assert.match(js,/taskDeleteConfirmation/);
  assert.match(js,/rpc\('delete_staff_task',\{p_id:editing.id,p_version:editing.version\}\)/);
});
