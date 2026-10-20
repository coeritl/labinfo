import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('solicitação de software usa token hash e cria chamado somente na confirmação',async()=>{
  const sql=await read('supabase/migrations/20261020_semester_software_requests.sql');
  assert.match(sql,/encode\(digest\(v_token::text,'sha256'\),'hex'\)/);
  assert.match(sql,/where r\.confirmation_token_hash=encode\(digest\(p_token::text,'sha256'\),'hex'\)/);
  const submit=sql.slice(sql.indexOf('function public.submit_software_request'),sql.indexOf('function public.confirm_software_request'));
  assert.doesNotMatch(submit,/insert into public\.tickets/i);
  const confirm=sql.slice(sql.indexOf('function public.confirm_software_request'),sql.indexOf('function public.cancel_software_request'));
  assert.match(confirm,/insert into public\.tickets/i);
  assert.match(confirm,/public\.next_protocol/);
});

test('RPC pública valida campanha, SIAPE ativo, limite e conteúdo dos itens',async()=>{
  const sql=await read('supabase/migrations/20261020_semester_software_requests.sql');
  assert.match(sql,/enforce_rate_limit\('software_request'/);
  assert.match(sql,/s\.siape=btrim\(p_siape\) and s\.active/);
  assert.match(sql,/c\.active and now\(\) between c\.opens_at and c\.closes_at/);
  assert.match(sql,/jsonb_array_length\(p_items\) not between 1 and 30/);
  assert.match(sql,/public\.current_role\(\) is distinct from 'tecnico'::public\.app_role/);
});

test('interface possui campanha pública, administração e confirmação institucional',async()=>{
  const [html,js,admin,email]=await Promise.all([
    read('index.html'),read('software-requests.js'),read('supabase-integration.js'),read('google-apps-script/Code.gs')
  ]);
  assert.match(html,/software-requests(?:\.min)?\.js/);
  assert.match(js,/softwareRequestCampaign/);
  assert.match(js,/submit_software_request/);
  assert.match(js,/confirm_software_request/);
  assert.match(js,/staff_save_software_request_cycle/);
  assert.match(js,/Promise\.race\(\[request,timeout\]\)/);
  assert.match(js,/finally\s*\{/);
  assert.match(js,/\$\('#homeView \.home-hero'\)/);
  assert.match(js,/id,name,location,software_inventory/);
  assert.match(js,/softwareInstalledPanel/);
  assert.match(js,/renderInstalledSoftware/);
  assert.match(js,/Softwares instalados neste laboratório/);
  assert.match(js,/Selecione um laboratório para visualizar os softwares cadastrados/);
  assert.match(js,/Confirmação obrigatória por e-mail/);
  assert.match(js,/const form=event\.currentTarget/);
  assert.match(js,/form\.reset\(\)/);
  assert.match(admin,/softwareRequestsMenuButton/);
  assert.match(email,/Confirmar e criar chamado/);
  assert.match(email,/Cancelar solicitação/);
});
