import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSqlCorpus, resolveFunctionGrants } from './lib/sql-corpus.mjs';

const root=join(import.meta.dirname,'..');
const migration=readFileSync(join(root,'supabase/migrations/20261021_google_workspace_auth.sql'),'utf8');
const reservations=readFileSync(join(root,'reservations.js'),'utf8');
const software=readFileSync(join(root,'software-requests.js'),'utf8');
const integration=readFileSync(join(root,'supabase-integration.js'),'utf8');
const fallback404=readFileSync(join(root,'404.html'),'utf8');
const corpus=loadSqlCorpus();

test('identidade institucional exige Google, domínio IFMS e servidor ativo',()=>{
  assert.match(migration,/split_part\(login_email,'@',2\)<>\s*'ifms\.edu\.br'/i);
  assert.match(migration,/app_metadata[\s\S]*?google/i);
  assert.match(migration,/lower\(btrim\(s\.email\)\)=login_email and s\.active/i);
});

test('RPCs da conta institucional não são executáveis por visitantes anônimos',()=>{
  for(const name of ['get_my_ifms_identity','create_my_reservation_range','list_my_reservations','request_my_reservation_cancellation','submit_my_software_request','create_my_ticket','register_my_ticket_attachment','my_tickets_authenticated','request_my_chat_session']){
    const grants=resolveFunctionGrants(corpus,name);
    assert.ok(grants.seen,`RPC não encontrada: ${name}`);
    assert.equal(grants.canExecute('anon'),false,`${name} não pode aceitar anon`);
    assert.equal(grants.canExecute('authenticated'),true,`${name} deve aceitar authenticated`);
  }
});

test('frontend usa OAuth Google e mantém o fluxo SIAPE como contingência',()=>{
  assert.match(integration,/signInWithOAuth\(\{[\s\S]*?provider:'google'/);
  assert.match(integration,/hd:'ifms\.edu\.br'/);
  assert.match(integration,/searchParams\.set\('auth_refresh',Date\.now\(\)\.toString\(\)\)/);
  assert.match(integration,/const returnUrl=new URL\(sitePath\(''\),location\.origin\)/);
  assert.match(integration,/!oauthReturnDetected\)window\.addEventListener\('load'/);
  assert.match(fallback404,/var hash = location\.hash \|\| ''/);
  assert.match(integration,/onAuthStateChange\(\(event,session\)=>setTimeout\(async\(\)=>/);
  assert.match(integration,/if\(session&&\(isAdminRoute\|\|document\.body\.classList\.contains\('admin-route'\)\)&&!state\.profile\)/);
  assert.match(reservations,/google_auth_return/);
  assert.match(reservations,/sessionStorage\.setItem\('labinfo_google_auth_return',context\)/);
  assert.match(reservations,/if\(googleAuthReturn\)\{[\s\S]*?showPublic\('reservations',false\)[\s\S]*?history\.replaceState\(\{\},'',sitePath\('reservas'\)\)/);
  assert.match(integration,/publicSessionLogin/);
  assert.match(integration,/applySharedInstitutionalIdentity/);
  assert.match(integration,/ticketSiapeFallback/);
  assert.match(integration,/chatSiapeFallback/);
  assert.match(integration,/setTimeout\(\(\)=>\$\('#protocolButton'\)\?\.click\(\),0\)/);
  assert.match(integration,/Entrar com Gmail @ifms\.edu\.br/);
  assert.match(integration,/if\(!force&&!state\.profile\)/);
  assert.match(reservations,/toggleMyReservationsForm\(true\)/);
  assert.match(reservations,/create_my_reservation_range/);
  assert.match(reservations,/create_public_reservation_range/);
  assert.match(software,/submit_my_software_request/);
  assert.match(software,/submit_software_request/);
});
