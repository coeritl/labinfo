// Exportação compatível com a importação de servidores do SIGLAB, sem perfis privilegiados.
(() => {
  function cell(value) {
    let text = String(value ?? '');
    // Impede execução de fórmulas quando o arquivo for aberto em planilhas.
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function build(rows) {
    return '\uFEFFnome;email;siape;perfil;setores;ativo\r\n' + rows.map(row =>
      [row.full_name, row.email, row.siape, 'servidor', '', row.active === false ? 'nao' : 'sim']
        .map(cell).join(';')
    ).join('\r\n') + '\r\n';
  }
  window.labinfoServerCsvExport = { build };
})();
