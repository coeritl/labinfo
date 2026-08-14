const LABINFO = {
  // O controle de duplicidade é feito pelo ID de cada mensagem no Supabase.
  // Não excluímos a conversa pelo marcador, pois novas respostas chegam na mesma thread.
  incomingQuery: 'in:anywhere -in:sent -in:drafts -in:spam -in:trash newer_than:30d',
  processedLabel: 'LabInfo-Processado',
  maxThreads: 30,
  accountEmail: 'labinfo.tl@ifms.edu.br',
  logoUrl: 'https://coeritl.github.io/labinfo/assets/labinfo-logo.png',
  portalUrl: 'https://coeritl.github.io/labinfo/',
  supportUrl: 'https://coeritl.github.io/labinfo/suporte/'
};

function configurarIntegracao() {
  validarConfiguracao_();
  GmailApp.createLabel(LABINFO.processedLabel);
  ScriptApp.getProjectTriggers()
    .filter(t => ['executarIntegracao', 'processarEntradaProgramada', 'processarSaidaProgramada'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processarEntradaProgramada').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('processarSaidaProgramada').timeBased().everyMinutes(1).create();
  processarEntradaProgramada();
}

function processarEntradaProgramada() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    processarChamadosRecebidos_();
    // Envia imediatamente a confirmação dos chamados encontrados nesta consulta.
    const sent = enviarNotificacoesPendentes_();
    registrarMetricas_('inbox', sent);
  } finally {
    lock.releaseLock();
  }
}

function processarSaidaProgramada() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const sent = enviarNotificacoesPendentes_();
    registrarMetricas_('outbox', sent);
  } finally {
    lock.releaseLock();
  }
}

function processarChamadosRecebidos_() {
  const label = GmailApp.getUserLabelByName(LABINFO.processedLabel) || GmailApp.createLabel(LABINFO.processedLabel);
  const ownAddresses = [LABINFO.accountEmail].concat(GmailApp.getAliases()).map(email => String(email).toLowerCase());
  GmailApp.search(LABINFO.incomingQuery, 0, LABINFO.maxThreads).forEach(thread => {
    let threadOk = true;
    thread.getMessages().forEach(message => {
      const sender = extrairEmail_(message.getFrom());
      if (ownAddresses.includes(sender)) return;
      try {
        const result = rpc_('apps_script_register_inbound', {
          p_secret: segredo_(), p_message_id: message.getId(), p_sender: sender,
          p_subject: message.getSubject(), p_body: textoMensagem_(message)
        });
        if (result && result.accepted) importarImagens_(message, result);
        // Remetentes não cadastrados são apenas ignorados; nenhum chamado é criado.
      } catch (error) {
        console.error('Falha ao importar ' + message.getId() + ': ' + error.message);
        threadOk = false;
        return;
      }
    });
    if (threadOk) {
      thread.addLabel(label);
      thread.markRead();
    }
  });
}

function importarImagens_(message, ticket) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const images = message.getAttachments({includeInlineImages: true, includeAttachments: true})
    .filter(file => allowed.includes(String(file.getContentType()).toLowerCase()) && file.getBytes().length <= 5 * 1024 * 1024)
    .slice(0, 3);
  images.forEach((file, index) => {
    const original = file.getName() || `imagem-${index + 1}.${extensaoImagem_(file.getContentType())}`;
    const safeName = original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
    const path = `tickets/${ticket.ticket_id}/${Utilities.getUuid()}-${safeName}`;
    uploadStorage_(path, file);
    rpc_('register_public_attachment', {
      p_ticket: ticket.ticket_id, p_siape: ticket.siape, p_path: path,
      p_name: original.slice(0, 180), p_type: file.getContentType(), p_size: file.getBytes().length
    });
  });
}

function uploadStorage_(path, blob) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('SUPABASE_ANON_KEY');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = UrlFetchApp.fetch(props.getProperty('SUPABASE_URL') + '/storage/v1/object/ticket-attachments/' + encodedPath, {
    method: 'post', contentType: blob.getContentType(), payload: blob.getBytes(), muteHttpExceptions: true,
    headers: {apikey: key, Authorization: 'Bearer ' + key, 'x-upsert': 'false'}
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Falha ao enviar imagem: ' + response.getContentText());
}

function extensaoImagem_(mime) { return ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[String(mime).toLowerCase()] || 'jpg'; }

function enviarNotificacoesPendentes_() {
  const items = rpc_('apps_script_pull_outbox', {p_secret: segredo_(), p_limit: 25}) || [];
  let sent = 0;
  items.forEach(item => {
    try {
      const mail = montarEmail_(item.event_type, item.payload || {});
      enviarHtml_(item.recipient, mail.subject, mail.html);
      rpc_('apps_script_finish_outbox', {p_secret: segredo_(), p_id: item.id, p_success: true, p_error: null});
      sent++;
    } catch (error) {
      console.error('Falha no item ' + item.id + ': ' + error.message);
      rpc_('apps_script_finish_outbox', {p_secret: segredo_(), p_id: item.id, p_success: false, p_error: error.message});
    }
  });
  return sent;
}

function registrarMetricas_(kind, sent) {
  try { rpc_('apps_script_report_metrics', {p_secret: segredo_(), p_kind: kind, p_sent: sent || 0, p_remaining: null}); }
  catch (error) { console.error('Falha ao registrar métricas: ' + error.message); }
}


function montarEmail_(eventType, data) {
  if (String(eventType).indexOf('reserva_') === 0) return montarEmailReserva_(eventType, data);
  const names = {
    recebido: ['Chamado recebido pela equipe', 'Recebemos seu chamado e ele já está na fila de atendimento.', '#07852a', '&#10003;&#65038;', 'Solicitação registrada'],
    aberto_pelo_tecnico: ['Abrimos um chamado para você', 'A equipe técnica registrou um chamado vinculado ao seu cadastro. Você receberá por e-mail as próximas atualizações do atendimento.', '#07852a', '&#10003;&#65038;', 'Solicitação registrada'],
    em_atendimento: ['Chamado em atendimento', 'A equipe técnica iniciou o atendimento do seu chamado.', '#2167a8', '&#9881;', 'Atendimento em andamento'],
    atualizacao: ['Atualização do chamado', data.message || 'Há uma nova atualização no seu chamado.', '#d66a00', '!', 'Atenção: aguardando sua verificação'],
    concluido: ['Chamado concluído', 'O atendimento foi concluído pela equipe técnica.', '#086c3c', '&#10003;&#65038;', 'Atendimento resolvido']
    ,novo_chamado_tecnico: ['Novo chamado na fila', 'Um novo chamado foi registrado e está disponível para atribuição.', '#2167a8', '&#128276;', 'Atenção da equipe']
    ,resposta_servidor_tecnico: ['Servidor respondeu ao chamado', data.message || 'Há uma nova resposta aguardando análise da equipe.', '#d66a00', '!', 'Resposta pendente']
  };
  const content = names[eventType] || ['Atualização do LabInfo TL', 'Há uma novidade em seu chamado.', '#07852a', 'i', 'Nova informação'];
  return {
    subject: `${data.protocol || 'LabInfo TL'} — ${content[0]}`,
    html: layout_(content[0], content[1], data, {color:content[2],icon:content[3],label:content[4]})
  };
}

function montarEmailReserva_(eventType, data) {
  const types = {
    reserva_confirmar: ['Confirme sua solicitação de reserva', 'Recebemos sua solicitação. Confirme pelo botão abaixo para encaminhá-la à equipe.', '#2167a8', '&#9993;', 'Confirmar solicitação'],
    reserva_confirmada: ['Solicitação de reserva confirmada', 'Sua confirmação foi registrada. A reserva aguarda autorização da equipe.', '#d58a00', '&#10003;', 'Aguardando autorização'],
    reserva_autorizada: ['Reserva autorizada', 'A equipe autorizou a utilização do laboratório no horário solicitado.', '#08783e', '&#10003;', 'Reserva autorizada'],
    reserva_cancelada: ['Reserva cancelada', data.reason || 'A reserva foi cancelada pela equipe.', '#b5262c', '!', 'Reserva cancelada'],
    reserva_alterada: ['Reserva atualizada', 'A data, o horário ou o laboratório da reserva foi alterado pela equipe.', '#d66a00', '!', 'Atenção à alteração']
  };
  const content = types[eventType] || ['Atualização da reserva', 'Há uma nova informação sobre sua reserva.', '#07852a', 'i', 'Reserva'];
  const start = data.starts_at ? Utilities.formatDate(new Date(data.starts_at), 'America/Cuiaba', "dd/MM/yyyy ' às ' HH:mm") : 'Não informado';
  const end = data.ends_at ? Utilities.formatDate(new Date(data.ends_at), 'America/Cuiaba', 'HH:mm') : '';
  const action = eventType === 'reserva_confirmar' && data.confirmation_url
    ? `<a href="${escapar_(data.confirmation_url)}" style="display:inline-block;background:${content[2]};color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px">Confirmar reserva</a>`
    : `<a href="${LABINFO.portalUrl}reservas/" style="display:inline-block;background:${content[2]};color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px">Consultar reservas</a>`;
  return {subject:`${data.protocol || 'LabInfo TL'} — ${content[0]}`,html:`<!doctype html><html><body style="margin:0;background:#f2f6f3;font-family:Arial,sans-serif;color:#10231a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #dce7df"><tr><td style="padding:25px 30px;border-top:7px solid ${content[2]}"><img src="${LABINFO.logoUrl}" alt="LabInfo TL" width="235" style="display:block;max-width:100%;height:auto"></td></tr><tr><td style="padding:2px 30px 30px"><table role="presentation"><tr><td width="46" height="46" align="center" style="border-radius:50%;background:${content[2]};color:#fff;font-size:25px;font-weight:bold">${content[3]}</td><td style="padding-left:13px"><b style="color:${content[2]}">${escapar_(content[4])}</b><div style="color:#65736b;font-size:12px">${escapar_(data.protocol || '')}</div></td></tr></table><h1 style="font-size:25px;margin:18px 0 12px">${escapar_(content[0])}</h1><p style="font-size:16px;line-height:1.6">${escapar_(content[1])}</p><table role="presentation" width="100%" style="background:#f5f8f6;border-left:4px solid ${content[2]};border-radius:12px"><tr><td style="padding:16px;font-size:14px;line-height:1.8"><b>Atividade:</b> ${escapar_(data.title || '')}<br><b>Laboratório:</b> ${escapar_(data.lab || '')}<br><b>Data e horário:</b> ${escapar_(start)}${end ? ' às ' + escapar_(end) : ''}${data.reason ? '<br><b>Motivo:</b> '+escapar_(data.reason) : ''}</td></tr></table><p style="margin:24px 0 0">${action}</p></td></tr><tr><td style="background:#073d25;color:#dcebe2;padding:18px 30px;font-size:12px">LabInfo TL · Reservas dos Laboratórios de Informática · IFMS Campus Três Lagoas</td></tr></table></td></tr></table></body></html>`};
}

function layout_(title, message, data, visual) {
  const protocol = escapar_(data.protocol || '');
  if (data.feedback_url) data.feedback_url = String(data.feedback_url).replace('https://coeritl.github.io/labinfo/?feedback=', LABINFO.supportUrl + '?feedback=');
  data.portal_url = LABINFO.supportUrl;
  visual = visual || {color:'#07852a',icon:'i',label:'Informação'};
  return `<!doctype html><html><body style="margin:0;background:#f2f6f3;font-family:Arial,sans-serif;color:#10231a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #dce7df">
  <tr><td style="padding:25px 30px;border-top:7px solid ${visual.color}"><img src="${LABINFO.logoUrl}" alt="LabInfo TL" width="235" style="display:block;max-width:100%;height:auto"></td></tr>
  <tr><td style="padding:2px 30px 30px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="46" height="46" align="center" valign="middle" style="width:46px;height:46px;line-height:46px;border-radius:50%;background:${visual.color};color:#ffffff;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:28px;font-weight:900;mso-line-height-rule:exactly">${visual.icon}</td><td style="padding-left:13px"><div style="color:${visual.color};font-size:13px;font-weight:bold;letter-spacing:.05em">${escapar_(visual.label)}</div><div style="color:#65736b;font-size:12px;margin-top:3px">${protocol}</div></td></tr></table>
  <h1 style="font-size:25px;margin:10px 0 14px">${escapar_(title)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 22px">${escapar_(message)}</p>
  <table role="presentation" width="100%" style="background:${visual.color}12;border-left:4px solid ${visual.color};border-radius:12px"><tr><td style="padding:16px;font-size:14px;line-height:1.7">
  <b>Assunto:</b> ${escapar_(data.title || 'Não informado')}<br><b>Laboratório:</b> ${escapar_(data.lab || 'Não informado')}<br><b>Categoria:</b> ${escapar_(data.category || 'Não informada')}
  </td></tr></table><p style="margin:24px 0 0"><a href="${LABINFO.supportUrl}" style="display:inline-block;background:${visual.color};color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px">Consultar minhas solicitações</a>${data.status === 'Concluído' && data.feedback_url ? ` <a href="${escapar_(data.feedback_url)}" style="display:inline-block;margin-left:8px;background:#ffffff;color:${visual.color};border:2px solid ${visual.color};text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:10px">Confirmar atendimento</a>` : ''}</p>
  </td></tr><tr><td style="background:#073d25;color:#dcebe2;padding:18px 30px;font-size:12px">LabInfo TL · Suporte dos Laboratórios de Informática · IFMS Campus Três Lagoas</td></tr>
  </table></td></tr></table></body></html>`;
}

function htmlAviso_(message) { return layout_('Não foi possível registrar o chamado', message, {}); }
function enviarHtml_(to, subject, html) { GmailApp.sendEmail(to, subject, 'Abra este e-mail em um cliente compatível com HTML.', {htmlBody: html, name: 'LabInfo TL'}); }
function textoMensagem_(message) {
  const plain = (message.getPlainBody() || '').replace(/\r/g,'').trim();
  const markers = [/^Em .* escreveu:$/im,/^On .* wrote:$/im,/^De: .*$/im,/^-{2,}\s*Mensagem original\s*-{2,}$/im];
  let cut = plain.length;
  markers.forEach(pattern => { const match = pattern.exec(plain); if (match && match.index < cut) cut = match.index; });
  return plain.slice(0, cut).replace(/\n>{1,}.*(?:\n|$)/g,'\n').trim().slice(0, 2000);
}
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
