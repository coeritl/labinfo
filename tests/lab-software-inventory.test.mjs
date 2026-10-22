import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('migration cria inventário JSON estruturado e limitado por laboratório', async () => {
  const sql = await read('supabase/migrations/20261020_lab_software_inventory.sql');
  assert.match(sql, /add column if not exists software_inventory jsonb not null default '\[\]'::jsonb/i);
  assert.match(sql, /jsonb_typeof\(software_inventory\) = 'array'/i);
  assert.match(sql, /jsonb_array_length\(software_inventory\) <= 1000/i);
});

test('painel técnico importa TXT ou CSV e salva nome e versão separados', async () => {
  const integration = await read('supabase-integration.js');
  assert.match(integration, /accept="\.txt,\.csv,text\/plain,text\/csv"/);
  assert.match(integration, /SOFTWARE;VERSAO/);
  assert.match(integration, /software_inventory:software\.items/);
  assert.match(integration, /formatSoftwareInventory\(lab\.softwareInventory\)/);
});

test('agenda pública consulta e apresenta o inventário de software', async () => {
  const [html, reservations] = await Promise.all([read('index.html'), read('reservations.js')]);
  assert.match(html, /id="publicScheduleSoftware"/);
  assert.match(reservations, /operating_system,software_inventory/);
  assert.match(reservations, /renderPublicSoftwareInventory\(lab\)/);
  assert.match(reservations, /data-software-lab/);
  assert.match(reservations, /Ver softwares disponíveis/);
  assert.match(reservations, /openPublicSoftwareModal\(lab\)/);
  assert.match(reservations, /safe\(item\?\.name/);
  assert.match(reservations, /safe\(item\?\.version/);
});
