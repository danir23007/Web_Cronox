import { EmailType } from '../email/email.types';
import { LogisticsMilestone } from './fulfillment-events';
export const logisticsMail: Record<LogisticsMilestone, { type: EmailType; label: string; message: string }> = {
  SHIPPED: { type: EmailType.ORDER_SHIPPED, label: 'Pedido enviado', message: 'Tu pedido ya está en camino.' },
  OUT_FOR_DELIVERY: { type: EmailType.ORDER_OUT_FOR_DELIVERY, label: 'Pedido en reparto', message: 'Correos informa de que tu pedido está en reparto.' },
  DELIVERED: { type: EmailType.ORDER_DELIVERED, label: 'Pedido entregado', message: 'Tu pedido figura como entregado al destinatario o a una persona autorizada.' },
  INCIDENT: { type: EmailType.ORDER_INCIDENT, label: 'Incidencia en el envío', message: 'Correos informa de una incidencia. Consulta el seguimiento para conocer las novedades.' },
  RETURNED: { type: EmailType.ORDER_RETURNED, label: 'Devolución al remitente', message: 'Correos informa de la devolución del paquete al remitente. Este aviso no confirma ningún reembolso.' },
};
