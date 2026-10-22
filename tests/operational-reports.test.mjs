import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root=join(import.meta.dirname,'..');
const integration=readFileSync(join(root,'supabase-integration.js'),'utf8');
const app=readFileSync(join(root,'app.js'),'utf8');
const migration=readFileSync(join(root,'supabase/migrations/20261022_chat_presence_history.sql'),'utf8');
const cacheScript=readFileSync(join(root,'scripts/bump-cache-version.mjs'),'utf8');

test('supervisor acessa a área unificada de relatórios operacionais',()=>{
  assert.match(app,/supervisor:\['Relatórios operacionais'/);
  assert.match(integration,/supervisor:'relatorios'/);
  assert.match(integration,/route==='relatorios'\)showSection\('supervisor'\)/);
  assert.match(integration,/adminRouteSlug==='supervisor'\?'supervisor':'relatorios'/);
  assert.match(integration,/requested==='supervisor'[\s\S]*?sitePath\('admin\/relatorios'\)/);
});

test('relatórios oferecem períodos extensos, filtros e exportação',()=>{
  for(const value of ['90','180','current_semester','previous_semester','current_year','previous_year','all','custom'])assert.match(integration,new RegExp(`option value="${value}"`));
  assert.match(integration,/id="supervisorChannel"/);
  assert.match(integration,/id="supervisorTechnician"/);
  assert.match(integration,/function exportSupervisorCsv\(\)/);
  assert.match(integration,/window\.print\(\)/);
});

test('relatórios distinguem abertura, primeiro atendimento e conclusão',()=>{
  assert.match(integration,/startedAt:x\.started_at/);
  assert.match(integration,/const reportFirstAction=/);
  assert.match(integration,/Demanda e entrega por horário/);
  assert.match(integration,/Abertura[\s\S]*?1º atendimento[\s\S]*?Conclusão/);
  assert.match(integration,/id="supDemandHeatmap"/);
});

test('relatórios integram sessões de chat e presença histórica',()=>{
  assert.match(integration,/from\('chat_sessions'\).*limit\(5000\)/);
  assert.match(integration,/from\('staff_chat_presence_events'\)/);
  assert.match(integration,/function reportPresenceCoverage\(range\)/);
  assert.match(migration,/create table if not exists public\.staff_chat_presence_events/i);
  assert.match(migration,/after insert or update of is_online on public\.staff_chat_status/i);
  assert.match(migration,/current_role\(\) in \('tecnico','supervisor'\)/i);
  assert.doesNotMatch(migration,/grant\s+(?:all|insert|update|delete)[\s\S]*?to\s+authenticated/i);
});

test('cache-busting produz o mesmo hash no Windows e no Linux',()=>{
  assert.match(cacheScript,/replace\(\/\\r\\n\/g, ['"]\\n['"]\)/);
});
