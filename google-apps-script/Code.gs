const LABINFO = {
  incomingQuery: 'in:inbox -label:LabInfo-Processado newer_than:30d',
  processedLabel: 'LabInfo-Processado',
  maxThreads: 30,
  logoUrl: 'https://coeritl.github.io/labinfo/assets/labinfo-logo.png',
  portalUrl: 'https://coeritl.github.io/labinfo/'
};

function configurarIntegracao() {
  validarConfiguracao_();
  GmailApp.createLabel(LABINFO.processedLabel);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'executarIntegracao')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('executarIntegracao').timeBased().everyHours(1).create();
  executarIntegracao();
}

function executarIntegracao() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    processarChamadosRecebidos_();
    enviarNotificacoesPendentes_();
  } finally {
    lock.releaseLock();
  }
}

function processarChamadosRecebidos_() {
  const label = GmailApp.getUserLabelByName(LABINFO.processedLabel) || GmailApp.createLabel(LABINFO.processedLabel);
  GmailApp.search(LABINFO.incomingQuery, 0, LABINFO.maxThreads).forEach(thread => {
    thread.getMessages().forEach(message => {
      const sender = extrairEmail_(message.getFrom());
      try {
        const result = rpc_('apps_script_register_inbound', {
          p_secret: segredo_(), p_message_id: message.getId(), p_sender: sender,
          p_subject: message.getSubject(), p_body: textoMensagem_(message)
        });
        // Remetentes não cadastrados são apenas ignorados; nenhum chamado é criado.
      } catch (error) {
        console.error('Falha ao importar ' + message.getId() + ': ' + error.message);
        return;
      }
    });
    thread.addLabel(label);
    thread.markRead();
  });
}

function enviarNotificacoesPendentes_() {
  const items = rpc_('apps_script_pull_outbox', {p_secret: segredo_(), p_limit: 25}) || [];
  items.forEach(item => {
    try {
      const mail = montarEmail_(item.event_type, item.payload || {});
      enviarHtml_(item.recipient, mail.subject, mail.html);
      rpc_('apps_script_finish_outbox', {p_secret: segredo_(), p_id: item.id, p_success: true, p_error: null});
    } catch (error) {
      console.error('Falha no item ' + item.id + ': ' + error.message);
      rpc_('apps_script_finish_outbox', {p_secret: segredo_(), p_id: item.id, p_success: false, p_error: error.message});
    }
  });
}

function montarEmail_(eventType, data) {
  const names = {
    recebido: ['Chamado recebido pela equipe', 'Recebemos seu chamado e ele já está na fila de atendimento.'],
    em_atendimento: ['Chamado em atendimento', 'A equipe técnica iniciou o atendimento do seu chamado.'],
    atualizacao: ['Atualização do chamado', data.message || 'Há uma nova atualização no seu chamado.'],
    concluido: ['Chamado concluído', 'O atendimento foi concluído pela equipe técnica.']
  };
  const content = names[eventType] || ['Atualização do LabInfo TL', 'Há uma novidade em seu chamado.'];
  return {
    subject: `${data.protocol || 'LabInfo TL'} — ${content[0]}`,
    html: layout_(content[0], content[1], data)
  };
}

function layout_(title, message, data) {
  const protocol = escapar_(data.protocol || '');
  return `<!doctype html><html><body style="margin:0;background:#f2f6f3;font-family:Arial,sans-serif;color:#10231a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #dce7df">
  <tr><td style="padding:25px 30px;border-top:7px solid #07852a"><img src="${LABINFO.logoUrl}" alt="LabInfo TL" width="235" style="display:block;max-width:100%;height:auto"></td></tr>
  <tr><td style="padding:2px 30px 30px"><div style="color:#07852a;font-size:13px;font-weight:bold;letter-spacing:.08em">${protocol}</div>
  <h1 style="font-size:25px;margin:10px 0 14px">${escapar_(title)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 22px">${escapar_(message)}</p>
  <table role="presentation" width="100%" style="background:#f3f7f4;border-radius:12px"><tr><td style="padding:16px;font-size:14px;line-height:1.7">
  <b>Assunto:</b> ${escapar_(data.title || 'Não informado')}<br><b>Laboratório:</b> ${escapar_(data.lab || 'Não informado')}<br><b>Categoria:</b> ${escapar_(data.category || 'Não informada')}
  </td></tr></table><p style="margin:24px 0 0"><a href="${LABINFO.portalUrl}" style="display:inline-block;background:#087d3e;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px">Consultar meus chamados</a></p>
  </td></tr><tr><td style="background:#073d25;color:#dcebe2;padding:18px 30px;font-size:12px">LabInfo TL · Suporte dos Laboratórios de Informática · IFMS Campus Três Lagoas</td></tr>
  </table></td></tr></table></body></html>`;
}

function htmlAviso_(message) { return layout_('Não foi possível registrar o chamado', message, {}); }
function enviarHtml_(to, subject, html) { GmailApp.sendEmail(to, subject, 'Abra este e-mail em um cliente compatível com HTML.', {htmlBody: html, name: 'LabInfo TL'}); }
function textoMensagem_(message) { return (message.getPlainBody() || '').replace(/\r/g,'').trim().slice(0, 2000); }
function extrairEmail_(from) { const m = String(from).match(/<([^>]+)>/); return (m ? m[1] : from).trim().toLowerCase(); }
function escapar_(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function segredo_() { return PropertiesService.getScriptProperties().getProperty('INTEGRATION_SECRET'); }
function validarConfiguracao_() { ['SUPABASE_URL','SUPABASE_ANON_KEY','INTEGRATION_SECRET'].forEach(k => { if (!PropertiesService.getScriptProperties().getProperty(k)) throw new Error('Configure a propriedade ' + k); }); }

function rpc_(name, body) {
  validarConfiguracao_();
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('SUPABASE_ANON_KEY');
  const response = UrlFetchApp.fetch(props.getProperty('SUPABASE_URL') + '/rest/v1/rpc/' + name, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true,
    headers: {apikey: key, Authorization: 'Bearer ' + key}
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error(response.getContentText());
  const text = response.getContentText(); return text ? JSON.parse(text) : null;
}
