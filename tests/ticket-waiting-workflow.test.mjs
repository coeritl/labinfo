import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root=join(import.meta.dirname,'..');
const integration=readFileSync(join(root,'supabase-integration.js'),'utf8');
const app=readFileSync(join(root,'app.js'),'utf8');
const html=readFileSync(join(root,'index.html'),'utf8');
const migration=readFileSync(join(root,'supabase/migrations/20261022_ticket_waiting_workflow.sql'),'utf8');

test('banco oferece estado Aguardando com pausa contabilizada e acesso técnico',()=>{
  assert.match(migration,/add value 'Aguardando'/i);
  assert.match(migration,/waiting_total_seconds=waiting_total_seconds\+/i);
  assert.match(migration,/create or replace function public\.staff_wait_ticket/i);
  assert.match(migration,/create or replace function public\.staff_resume_ticket/i);
  assert.match(migration,/current_role\(\)<>\s*'tecnico'/i);
  assert.doesNotMatch(migration,/grant execute on function public\.staff_(?:wait|resume)_ticket[^;]*to anon/i);
});

test('preparação do laboratório é um motivo explícito e notifica o solicitante',()=>{
  assert.match(migration,/'preparacao_laboratorio'/);
  assert.match(migration,/Preparação do laboratório/);
  assert.match(migration,/kind,visible_to_server[\s\S]*?'atualizacao',true/);
  assert.match(integration,/<option value="preparacao_laboratorio">Preparação do laboratório<\/option>/);
  assert.match(integration,/O solicitante receberá por e-mail o motivo e a data prevista/);
});

test('painel permite colocar em espera, revisar e retomar',()=>{
  assert.match(html,/<option>Aguardando<\/option>/);
  assert.match(html,/id="waitingTicketsMetric"/);
  assert.match(integration,/sb\.rpc\('staff_wait_ticket'/);
  assert.match(integration,/sb\.rpc\('staff_resume_ticket'/);
  assert.match(integration,/Revisão prevista/);
  assert.match(app,/s===['"]Aguardando['"]\?['"]hold['"]/);
});

test('relatório separa tempo aguardando de tempo ativo',()=>{
  assert.match(integration,/const reportTicketWaitingMinutes=/);
  assert.match(integration,/id="supActiveTime"/);
  assert.match(integration,/id="supWaitingTickets"/);
  assert.match(integration,/Período aguardando \(min\)/);
  assert.match(integration,/Tempo ativo \(min\)/);
});
