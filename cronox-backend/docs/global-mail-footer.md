# Footer global de correo CRONOX

Implementado en código y validado localmente. No se han enviado mensajes reales, modificado variables de producción ni republicado plantillas. El cambio conserva el trabajo de recuperación de carritos existente en el árbol de trabajo.

## Composición y cobertura

`mail-global-footer.ts` genera una única presentación compartida y su equivalente en texto. `composeApplicationMail` la aplica sin escribir plantillas, versiones, estados ni publicaciones:

| Recorrido | Punto de integración |
| --- | --- |
| Pedidos y seguimiento, contraseñas, cambio de email, acceso, bienvenida, reposición, ascensos, carrito y futuras finalidades | `MailTransportFactory.sendMail`, antes de compilar MIME |
| Vista previa, edición, versiones publicadas y pruebas del gestor | `ManagedMailService.render`; las pruebas conservan la finalidad visual aunque su auditoría sea `ADMIN_TEST` |
| Buzón: mensajes manuales, respuestas, plantillas y texto sin HTML | `MailboxSenderService.process`, antes del compositor MIME |
| Vista del borrador de buzón | `MailboxService.draftView`, sin cambiar el borrador almacenado |
| Campañas por círculos y sus vistas previas | `MailboxCampaignService.plan` y composición final antes de SMTP |
| Campañas congeladas antes del cambio | Composición final, sin alterar su versión congelada |
| Pedidos ya pendientes de cuota con MIME antiguo | Se reconstruye el MIME antes de enviarlo, conservando Message-ID, destinatarios, cuerpo, adjuntos y cabeceras de hilo |

Las tres vías SMTP encontradas en `src/` pasan por la misma función. Una plantilla futura no necesita incluir bloques de footer. Una nueva finalidad comercial debe declararse en `COMMERCIAL_MAIL_PURPOSES` para tener la etiqueta y exclusión comercial correctas; su footer se incorpora incluso antes de esa clasificación.

Se reconocen los marcadores del footer generado para reemplazarlo, también al pasar por el sanitizador existente o al responder citando un correo anterior. Se retiran de forma precisa la antigua fila de contacto de bienvenida, su variante de contacto de respaldo, los párrafos antiguos de baja de campañas, el cierre de marca del carrito y las filas terminales de marca sin más contenido. Se conservan cabeceras, firmas humanas, información del pedido, consejos específicos de soporte, imágenes de eslogan y contenido de mensajes citados. No se aplica una eliminación genérica de `<footer>`, firmas o párrafos que mencionen soporte.

## Recursos y diseño

- Logo oficial: PNG claro y oscuro ya existentes en `assets/mail/order-confirmation/`.
- Soporte: `support@cronox.es`, confirmado en la política de privacidad, las plantillas y los flujos de cambio de email.
- Instagram: `https://www.instagram.com/cronox.es/`, presente en la web y en las plantillas.
- Redes: se lee `FooterSettings`, compartido con el administrador de la web. Instagram, TikTok y YouTube aparecen siempre, en ese orden. Los valores de ejemplo, vacíos o inseguros no se convierten en enlaces. Sin URL oficial se muestra únicamente la imagen, sin interacción ni cursor de enlace. Al configurar una URL HTTPS oficial válida, el componente la enlaza automáticamente.
- Iconos: seis PNG de alta densidad, derivados de los SVG existentes de la web mediante `scripts/build-mail-footer-icons.cjs`. El correo utiliza PNG y no depende de SVG incrustado, fuentes de iconos, scripts o estilos de la web.

El footer usa tablas de presentación, estilos inline, ancho fluido hasta 640 px, enlaces sociales con área de 44 px, tamaños de imagen explícitos, textos alternativos y enlaces con nombre accesible. El separador, el soporte y el copyright quedan centrados. El año se calcula en cada composición con el reloj actual y zona `Europe/Madrid`.

Se toma el fondo del diseño, incluido el lienzo de pedido por círculo y la bienvenida, y se elige texto con contraste mínimo 4,5:1. En los diseños adaptables se incluyen variantes oscuras de logo/iconos y reglas limitadas al footer. Las composiciones declaradas `light only` conservan esa decisión. Las capturas se han revisado en Chromium; no equivalen a una certificación de Outlook, Gmail o Apple Mail reales, cuyas transformaciones de color pueden diferir.

## Baja y preferencias

El texto visible del enlace compartido es exactamente «actualiza tus preferencias» en todas las finalidades, vistas previas y versiones en texto plano. Su destino y comportamiento se conservan. Se ha retirado la frase explicativa adicional del footer sin modificar la clasificación ni las reglas comerciales o transaccionales.

El logo mantiene sus 120 px y proporciones. El padding superior/inferior de su celda pasa de 24/8 a 12/4 px; el padding vertical de los iconos, de 12 a 6 px; la separación posterior a redes, de 10 a 5 px; y la separación del separador al soporte, de 16 a 8 px. Se conserva el espacio horizontal y la alineación de las tres redes.

Para un único destinatario se reutiliza `/api/mailbox-unsubscribe/<token opaco>`. Los enlaces existentes continúan siendo válidos. El GET presenta una confirmación y no cambia preferencias; el POST validado registra `MailboxSuppression` y desactiva `newsletterSubscribed`. La exclusión se comprueba en el transporte para las finalidades comerciales, además de los filtros de audiencia existentes. Los correos necesarios no consultan esa exclusión.

Los tokens nuevos reutilizan el llavero cifrado del buzón cuando está disponible. Si no lo está, se usa AES-256-GCM con una clave derivada exclusivamente para preferencias de `EMAIL_PREFERENCES_SECRET` o del secreto obligatorio `JWT_ACCESS_SECRET`. No hay direcciones personales legibles en la URL, ni identificadores de cuenta que el cliente pueda sustituir. Los tokens manipulados fallan antes de cualquier escritura. Para desacoplar su vida útil de la rotación del JWT, se puede configurar un `EMAIL_PREFERENCES_SECRET` estable de al menos 32 caracteres; no es una nueva condición obligatoria para enviar correos de seguridad.

Las vistas previas usan la página real `/preferencias-correo` en lugar de crear tokens de baja de clientes. Los mensajes con varios destinatarios usan esa misma página: nunca se comparte con todos un token que permita dar de baja a uno de ellos. La página requiere iniciar sesión y opera exclusivamente sobre esa cuenta; una petición no puede elegir otra dirección. Si el destinatario no tiene cuenta, dispone del contacto de soporte. La página también funciona con la tienda cerrada por Pantalla Clave y está marcada como no indexable.

La revisión para el sitio español se ha basado en los [artículos 10, 21 y 22 de la LSSI](https://www.boe.es/eli/es/l/2002/07/11/34/con): información del prestador, autorización comercial y retirada del consentimiento. No se utiliza la baja para cancelar avisos necesarios. No se ha identificado en esos preceptos una obligación de repetir el domicilio postal en cada footer; la información del titular ya consta en el aviso legal y la política del sitio. No se añade una dirección postal por estética ni se inventa ningún dato. Esto no verifica requisitos de campañas dirigidas bajo otras jurisdicciones.

## Validación y vistas previas

Se han probado finalidades y círculos I–V, HTML y texto plano, idempotencia tras sanitizado, firmas y cabeceras conservadas, baja segura, destinatarios múltiples, bloqueo comercial independiente de correos necesarios y futuro correo desconocido. Las pruebas de MIME ejercitan las vías reales con SMTP simulado: automático, respuesta con adjunto e hilo, campaña congelada y pedido diferido antiguo.

El conjunto de correo, buzón, newsletter y reposiciones pasó **713 pruebas** en su ejecución de regresión, incluidas las comprobaciones de modo claro fijo, contraste y respuestas citadas. También se ejecutó la integración PostgreSQL de carritos/gestor en una base local desechable, sin SMTP, que confirma publicación por círculo, aislamiento de borradores posteriores e inicialización idempotente. Se han generado vistas y capturas de los círculos I–V, incluyendo móvil oscuro.

Reproducción, desde `cronox-backend`:

```text
npm test -- --runInBand email mailbox newsletter waitlist cart-abandonment.spec --silent
npm run typecheck
npm run build:compiled
node scripts/preview-global-mail-footer.cjs
```

Desde la raíz, con el Playwright ya instalado:

```text
node node_modules/playwright/cli.js screenshot --viewport-size "1280,1000" --full-page file:///RUTA/AL/REPOSITORIO/output/playwright/mail-footer/circle-3.html output/playwright/mail-footer/desktop.png
```

Las vistas están en `output/playwright/mail-footer/index.html`, con enlaces a los ocho diseños y sus textos planos. `desktop.png`, `mobile.png` y `mobile-dark.png` muestran ejemplos completos. Las copias HTML usan recursos locales para poder revisarlas sin red; los correos de aplicación conservan sus URL públicas.

## Despliegue y configuración pendiente

El footer no requiere una migración propia ni republicar diseños. Desplegar conjuntamente backend, nueva página de preferencias, scripts y PNG de `assets/mail/global-footer/`, además de los logos públicos que ya existen. Verificar `FRONTEND_URL` y `API_PUBLIC_URL`, que ya eran necesarios para el resto de correos. Enviar únicamente a una cuenta de prueba controlada si después se decide verificar un cliente de correo real.

Pendiente de configuración: las URL oficiales de TikTok y YouTube. Sus iconos ya son visibles sin enlace. Las comprobaciones locales utilizan SMTP simulado; la validación visual en Chromium no certifica el renderizado de clientes de correo reales. El resultado de publicación se documenta en la entrega del release, sin republicar plantillas.
