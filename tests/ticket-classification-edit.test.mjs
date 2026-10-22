import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root=join(import.meta.dirname,'..');
const integration=readFileSync(join(root,'supabase-integration.js'),'utf8');

test('editor do chamado altera somente categoria e laboratório',()=>{
  const start=integration.indexOf('const renderDetailWithTicketEditor');
  const end=integration.indexOf('const assign =',start);
  assert.ok(start>0&&end>start,'bloco do editor não encontrado');
  const editor=integration.slice(start,end);
  assert.match(editor,/Corrigir classificação/);
  assert.match(editor,/Registro original preservado/);
  assert.doesNotMatch(editor,/ticketEditTitle|ticketEditDescription/);
  assert.match(editor,/update\(\{category_id:categoryId,lab_id:labId,updated_at:now\}\)/);
  assert.doesNotMatch(editor,/update\(\{[^}]*\btitle\b|update\(\{[^}]*\bdescription\b/);
});

test('correção gera auditoria interna com valores anteriores e novos',()=>{
  assert.match(integration,/kind:'classificacao',visible_to_server:false/);
  assert.match(integration,/Categoria: “\$\{previousCategory\}” → “\$\{category\?\.name/);
  assert.match(integration,/Laboratório: “\$\{previousLab\}” → “\$\{lab\?\.name/);
  assert.match(integration,/Histórico de mensagens e correções/);
  assert.match(integration,/classificacao'\?\s*'classification-update'/);
});

test('falha no histórico cancela a correção para preservar a auditoria',()=>{
  assert.match(integration,/if \(history\.error\) \{[\s\S]*?category_id:previousCategoryId,lab_id:previousLabId/);
  assert.match(integration,/A correção foi cancelada porque não foi possível registrar a auditoria/);
});
