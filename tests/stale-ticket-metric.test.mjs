import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root=join(import.meta.dirname,'..');
const html=readFileSync(join(root,'index.html'),'utf8');
const integration=readFileSync(join(root,'supabase-integration.js'),'utf8');

test('painel troca tempo médio por chamados sem atualização',()=>{
  assert.match(html,/id="staleTicketsMetric"[\s\S]*?<small>Sem atualização<\/small>/);
  assert.doesNotMatch(html,/<small>Tempo médio<\/small>/);
  assert.match(html,/<option>Sem atualização<\/option>/);
});

test('métrica usa a última movimentação e filtra chamados abertos há sete dias',()=>{
  assert.match(integration,/const STALE_TICKET_MS=7\*24\*60\*60\*1000/);
  assert.match(integration,/ticket\.createdAt,ticket\.updatedAt,[\s\S]*?update\.createdAt/);
  assert.match(integration,/ticket\.status!==['"]Concluído['"]/);
  assert.match(integration,/status===['"]Sem atualização['"]\?isTicketStale\(ticket\)/);
  assert.match(integration,/staleMetric\.onclick=showStaleTickets/);
});
