import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../server-csv-export.js',import.meta.url),'utf8'),context);
const build=context.window.labinfoServerCsvExport.build;
test('exportação SIGLAB preserva SIAPE e situação sem copiar privilégios',()=>{
  const csv=build([{full_name:'José; "Silva"',email:'jose@ifms.edu.br',siape:'00123',active:false,role:'admin'}]);
  assert.ok(csv.startsWith('\uFEFFnome;email;siape;perfil;setores;ativo\r\n'));
  assert.ok(csv.includes('"José; ""Silva"""'));
  assert.ok(csv.includes('"00123";"servidor";"";"nao"'));
  assert.ok(!csv.includes('admin'));
});
test('exportação neutraliza fórmulas e aceita cadastro ativo',()=>{
  const csv=build([{full_name:'=CMD()',email:'p@ifms.edu.br',siape:'7',active:true}]);
  assert.ok(csv.includes('"\'=CMD()"'));
  assert.ok(csv.includes('"sim"'));
});
