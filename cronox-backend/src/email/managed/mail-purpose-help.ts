/** Administrator-only catalogue metadata. These texts never enter a draft,
 * publication snapshot, preview payload or the customer's email HTML. */
export interface MailPurposeHelp {
  description: string;
  delivery: string;
  trigger: string;
}

export const MAIL_PURPOSE_HELP: Record<string, MailPurposeHelp> = {
  CART_ABANDONED: {
    description: 'Recuerda una cesta de una cuenta identificada con consentimiento comercial vigente.',
    delivery: 'Automático al habilitar el trabajador y su fecha de inicio; revisión cada 10 segundos.',
    trigger: '23 horas desde la última actividad real: cambios, combinación al iniciar sesión o apertura explícita de la cesta. Las lecturas automáticas no cuentan. No se envía mientras exista una compra o pago sin conciliar. Un resultado SMTP incierto requiere revisión y no se reintenta.',
  },
  CIRCLE_PROMOTION: {
    description: 'Confirma la nueva membresía, muestra las ventajas desbloqueadas y enlaza a la acreditación de la cuenta.',
    delivery: 'Automático desde No-reply.',
    trigger: 'Al confirmarse una subida al Círculo II, III, IV o V en una cuenta activa. Se genera un aviso para el círculo alcanzado.',
  },
  ORDER_CONFIRMATION: {
    description: 'Confirma al comprador que su pedido online está pagado y resume los artículos, importes y datos del cliente.',
    delivery: 'Automático tras confirmar el pago.',
    trigger: 'Cuando se verifica el pago y se registra el pedido. Se procesa en la cola del checkout, con el correo habilitado; evita repetir una confirmación ya enviada.',
  },
  ORDER_SHIPPED: {
    description: 'Comunica al comprador que su pedido ha salido y facilita el seguimiento disponible.',
    delivery: 'Automático, también cuando el cambio de estado lo realiza el administrador.',
    trigger: 'Al pasar un pedido elegible a Enviado desde el administrador o al recibir evidencia válida de envío de Correos. Requiere correo y procesamiento de avisos; los eventos de Correos requieren además los avisos logísticos habilitados. Excluye recogidas y ventas presenciales.',
  },
  ORDER_DELIVERED: {
    description: 'Informa al comprador de que su pedido figura como entregado.',
    delivery: 'Automático, también cuando el cambio de estado lo realiza el administrador.',
    trigger: 'Al pasar un pedido elegible a Entregado desde el administrador o al recibir una entrega válida de Correos. La cola evita avisos repetidos; requiere correo y procesamiento de avisos, y la opción logística para eventos de Correos. Excluye recogidas y ventas presenciales.',
  },
  ORDER_OUT_FOR_DELIVERY: {
    description: 'Avisa al comprador de que Correos tiene su paquete en reparto.',
    delivery: 'Automático por un evento de Correos.',
    trigger: 'Cuando la sincronización de Correos incorpora un evento nuevo y válido de En reparto. La cola descarta duplicados y eventos históricos o fuera de orden; requiere correo, procesamiento de avisos y avisos logísticos habilitados para un pedido con envío elegible.',
  },
  ORDER_INCIDENT: {
    description: 'Comunica al comprador una incidencia de Correos y le dirige al seguimiento de su paquete.',
    delivery: 'Automático por un evento de Correos.',
    trigger: 'Cuando Correos comunica una incidencia nueva y válida para el envío. Se procesa en cola, sin repetir la misma incidencia ni avisar por eventos históricos o fuera de orden. Requiere correo, procesamiento de avisos y avisos logísticos habilitados; no se dispara por cambiar un texto o publicar el diseño.',
  },
  ORDER_RETURNED: {
    description: 'Informa al comprador de que Correos ha devuelto el paquete al remitente. El aviso no confirma un reembolso.',
    delivery: 'Automático por un evento de Correos.',
    trigger: 'Al incorporar una devolución nueva y válida de Correos para un pedido con envío elegible. La cola comprueba el evento y evita repeticiones; requiere correo, procesamiento de avisos y avisos logísticos habilitados.',
  },
  ORDER_TRACKING: {
    description: 'Diseño heredado de seguimiento genérico de pedidos; se conserva para consulta y personalización.',
    delivery: 'Manual para pruebas; sin disparador automático propio verificado.',
    trigger: 'El flujo logístico actual utiliza los avisos específicos de enviado, reparto, entrega, incidencia y devolución. Esta finalidad genérica no genera esos avisos por sí sola.',
  },
  RESTOCK: {
    description: 'Avisa a quien pidió una notificación de que vuelve a estar disponible la talla de un producto.',
    delivery: 'Automático tras una solicitud previa del cliente.',
    trigger: 'Cuando la talla solicitada vuelve a tener existencias y el producto y la variante están activos. La cola comprueba la solicitud y la cuenta; requiere tienda abierta, trabajador de reposición y correo configurados. No reserva la prenda.',
  },
  NEWSLETTER_WELCOME: {
    description: 'Da la bienvenida a una cuenta nueva y entrega su descuento personal de primera compra online.',
    delivery: 'Automático al crear una cuenta nueva.',
    trigger: 'Cuando el alta de una cuenta genera por primera vez su trabajo de bienvenida. La cola valida el código personal del 10 %, su titular y su disponibilidad, con el correo y el trabajador de newsletter configurados. Suscribirse con una cuenta existente no genera otra bienvenida ni otro código.',
  },
  NEWSLETTER_ACCESS: {
    description: 'Responde a una solicitud de acceso desde newsletter para el titular del correo. Según la cuenta, ofrece acceso seguro o indica cómo entrar o registrarse.',
    delivery: 'Automático a petición del cliente.',
    trigger: 'Cuando una dirección ya suscrita solicita otro enlace de acceso, o el flujo de suscripción de una cuenta existente programa ese acceso. La cola vuelve a comprobar la cuenta y limita solicitudes repetidas; requiere correo y trabajador de newsletter configurados. No equivale a la bienvenida con descuento.',
  },
  PASSWORD_RESET: {
    description: 'Permite al titular de una cuenta restablecer su contraseña mediante un enlace seguro.',
    delivery: 'Automático a petición del cliente.',
    trigger: 'Al solicitar la recuperación de contraseña y superar las comprobaciones de la cuenta. Se guarda un enlace de un solo uso con caducidad antes de enviar el correo; requiere el servicio de correo habilitado.',
  },
  PASSWORD_SETUP_NEW_ACCOUNT: {
    description: 'Permite al comprador configurar la contraseña de la cuenta nueva creada durante su compra y consultar el pedido.',
    delivery: 'Automático tras una compra con cuenta nueva.',
    trigger: 'Después de confirmar el pago, cuando el checkout ha creado una cuenta sin contraseña. La cola comprueba que siga activa, sin contraseña y sin este aviso ya enviado. Requiere correo habilitado; conserva los enlaces de configuración y recuperación.',
  },
  PASSWORD_SETUP_EXISTING_ACCOUNT: {
    description: 'Permite al comprador poner contraseña a una cuenta que ya existía y acceder a su pedido, sin presentarla como una cuenta nueva.',
    delivery: 'Automático tras una compra con cuenta existente sin contraseña.',
    trigger: 'Después de confirmar el pago, si la compra pertenece a una cuenta existente que todavía no tiene contraseña. La cola vuelve a comprobar la cuenta y evita repetir el aviso; requiere correo habilitado. Si ya tiene contraseña, este correo no corresponde.',
  },
  INITIAL_PASSWORD_SETUP: {
    description: 'Diseño heredado de configuración inicial de contraseña, conservado como respaldo compatible.',
    delivery: 'Automático como respaldo heredado; sin evento nuevo propio.',
    trigger: 'Puede reutilizarse, adaptado al caso, para una compra con cuenta nueva o existente sin contraseña cuando falta una publicación específica en ese círculo. El disparador sigue siendo la compra pagada y las comprobaciones de configuración de contraseña.',
  },
  SUPPORT_TICKET_RECEIVED: {
    description: 'Acusa recibo de una consulta al remitente e identifica su ticket de soporte.',
    delivery: 'Manual para pruebas; automatización no verificada.',
    trigger: 'Existe la finalidad y su renderizador, pero no se ha localizado un flujo de creación de tickets que envíe este correo automáticamente. Publicarla deja el diseño disponible; no inicia envíos a clientes. Las pruebas del editor se solicitan expresamente.',
  },
};
