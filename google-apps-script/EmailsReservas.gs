// Complemento carregado pelo projeto ativo para diferenciar reservas,
// solicitações de software e chamados. Os templates ficam centralizados no
// Code.gs para evitar que uma cópia antiga sobrescreva os fluxos mais novos.
var montarEmailChamado_ = montarEmail_;

montarEmail_ = function(eventType, data) {
  var tipo = String(eventType || '');
  var payload = data || {};
  if (tipo.indexOf('software_') === 0) return montarEmailSoftware_(tipo, payload);
  if (tipo.indexOf('reserva_') === 0) return montarEmailReserva_(tipo, payload);
  return montarEmailChamado_(tipo, payload);
};
