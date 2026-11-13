import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('../supabase-integration.js',import.meta.url),'utf8');
test('arquivamento em lote considera apenas concluídos visíveis na fila',()=>{
  const source=js.match(/function completedTicketIds\(rows\)\{[^\n]+\}/)[0];
  const ctx={};vm.runInNewContext(source,ctx);
  const ids=ctx.completedTicketIds([{dbId:'1',status:'Concluído'},{dbId:'2',status:'Em atendimento'},{dbId:'3',status:'Aguardando'},{dbId:'4',status:'Concluído',deletedAt:'ontem'},{dbId:'5',status:'Concluído',archivedAt:'ontem'}]);
  assert.deepEqual(Array.from(ids),['1']);
});
test('ação confirma na página, verifica status no banco e preserva anexos',()=>{
  const action=js.slice(js.indexOf("$('#confirmCompletedArchive').onclick"),js.indexOf('const queueCreate='));
  assert.match(action,/state.profile\?\.role!=='tecnico'/);
  assert.match(action,/\.eq\('status','Concluído'\)\.is\('archived_at',null\)\.is\('deleted_at',null\)/);
  assert.doesNotMatch(action,/storage\.from|from\('attachments'\)|from\('tickets'\)\.delete/);
  assert.match(js,/completedArchiveConfirmation/);
});
