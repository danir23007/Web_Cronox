/** Only the carrier's dedicated reason description from this RETURNED event.
 * Never interpret reason codes, event labels or earlier tracking history. */
export function readableReturnReason(value: unknown, code?: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.replace(/\s+/g, ' ').trim();
  if (!reason || reason.length > 600 || /[<>\u0000-\u001f\ufffd]/.test(reason)) return null;
  const normalized = reason.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,:;!]+$/g,'').trim();
  if (typeof code === 'string' && normalized === code.trim().toLowerCase()) return null;
  if (!/[a-záéíóúüñ]{3}/i.test(reason) || /^[\w-]*\d[\w-]*$/.test(reason) || /^[A-Z_-]{1,5}$/.test(reason)) return null;
  if (/^(?:devuelto(?: al remitente)?|devolucion(?: al remitente)?|retornado(?: al remitente)?|returned|por definir|sin (?:motivo|especificar|descripcion|datos|informacion)|no (?:disponible|especificado|informado|consta)|desconocido|null|undefined|n\/a)$/i.test(normalized)) return null;
  if (/^(?:(?:el )?(?:envio|paquete) )?(?:ha sido )?(?:devuelto|retornado|entregado) al remitente(?: en oficina)?$/.test(normalized) || normalized === 'se ha entregado el envio al remitente') return null;
  return reason;
}
