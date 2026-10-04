# CRONOX: plantillas, No-reply y contraseñas

La revisión conjunta posterior, la corrección de incertidumbre SMTP y el
procedimiento de publicación están en [la revisión integrada](mail-admin-joint-release-review-2026-10-04.md).
Los resultados siguientes corresponden a la entrega original.

Se retiran del catálogo, importación, panel y selectores las finalidades
`PRE_REGISTRATION_CONFIRMATION`, `LAUNCH`, `NEWSLETTER_CONFIRMATION`,
`FIRST_ORDER_DISCOUNT`, `GENERIC` y `TEST`. El servicio rechaza su envío,
el prerregistro ya no manda confirmaciones y el trabajador de lanzamiento
no arranca ni admite reanudación. Se conservan los renderizadores internos,
el historial, los descuentos y la comprobación de conexiones sin envío.

`NEWSLETTER_ACCESS`, `NEWSLETTER_WELCOME` y `RESTOCK` usan las credenciales
y dirección de `SMTP_NOREPLY_USER/PASS`, incluidas las comprobaciones de
disponibilidad, las publicaciones y el transporte. Info conserva las campañas
personalizadas; pedidos y soporte conservan sus cuentas. Los intentos automáticos
de No-reply comparten un presupuesto atómico por cuenta: por defecto 100 en una
hora móvil y 1000 en 24 horas móviles. Se configura con
`SMTP_NOREPLY_HOURLY_LIMIT` y `SMTP_NOREPLY_DAILY_LIMIT`. Las campañas de Info
ya no consumen capacidad por estos avisos. Los límites del proveedor real
deben revisarse antes de publicar; no se ha contactado con él.

## Contraseñas y entregas

Solo una cuenta ACTIVE, USER/FRIEND, con email coincidente y sin contraseña
recibe una palabra inventada de 7–8 letras minúsculas, generada con `randomInt`
criptográfico. El hash bcrypt y el token de acceso se guardan en una transacción.
Las actualizaciones condicionales impiden sobrescribir una contraseña existente
o repetir el despacho del mismo trabajo. El secreto solo existe en memoria y
en el mensaje saliente; no se registra en asunto, base de datos ni metadatos.
Las solicitudes no crean ni activan cuentas y no cambian roles.

El correo muestra la contraseña entre comillas y pide introducirla sin ellas.
La plantilla editable y el respaldo la incluyen cuando corresponde. Una
publicación anterior conserva su diseño y recibe el bloque obligatorio al
renderizar el envío. El enlace sigue siendo de un uso y caduca en 20 minutos.

Un rechazo SMTP confirmado permite retirar únicamente el hash recién generado
si sigue siendo el mismo, y reintentar. Nunca se borra un cambio posterior del
cliente. Un resultado incierto o una interrupción conserva el hash y el enlace,
queda UNCERTAIN y no se reenvía automáticamente. Sin almacenar el secreto no
se puede recuperar esa contraseña para otro correo: si el primero no llegó,
el cliente puede usar otro enlace de acceso o el restablecimiento existente.

El perfil expone solo `hasPassword`. El formulario usa la sesión autenticada y
CSRF; para una contraseña existente exige también la actual. Al guardar invalida
sesiones anteriores y tokens de restablecimiento, y emite una sesión nueva.
Ofrece nueva contraseña, confirmación y controles de mostrar/ocultar, conserva
lo escrito tras errores y bloquea solicitudes simultáneas. No existe un endpoint
para recuperar contraseñas.

Registro, restablecimiento y cambio comparten mínimo 7 caracteres, sin requisitos
de composición ni recorte de espacios. Se rechazan explícitamente contraseñas
que excedan 72 bytes UTF-8 para impedir el truncamiento de bcrypt. Las contraseñas
existentes no se reescriben.

## Migración y conflictos

`20261004120000_mail_purposes_noreply` archiva las plantillas retiradas y elimina
solo los punteros a sus publicaciones. Cancela trabajos pendientes vinculados
a finalidades retiradas o familias automáticas antiguas; no elimina entregas,
versiones ni datos de negocio. Los pendientes individuales de plantillas
trasladadas tampoco pueden salir con la cuenta anterior.

Se trasladan todos los borradores de las tres finalidades desde Info a No-reply,
conservando documento, asunto y personalizaciones. Las carpetas se reúnen por
nombre, sin sustituir las plantillas existentes. En una colisión de `importKey`,
el borrador trasladado conserva su identidad y contenido, con `importKey=null`.
La publicación ya existente en No-reply tiene prioridad; la alternativa de Info
se conserva con una nueva versión de enrutamiento. Si no hay publicación en
No-reply, se activa la trasladada. Los snapshots históricos no se reescriben.

Se copian las firmas de Info y se resuelve su firma por defecto a una selección
explícita para conservar el diseño. Las plantillas trasladadas se desvinculan
de familias de campañas, cuya restricción de base de datos exige Info. Las
familias automáticas antiguas se conservan fuera de los selectores; las campañas
personalizadas con plantillas sin finalidad siguen disponibles en Info.

## Verificación local

- Compilación Nest y compilación Vite aprobadas.
- Suite final: 176 suites y 1679 pruebas aprobadas. Quedan 12 fallos en 10 suites
  de frontend: imágenes, galería, stock, versiones de recursos, rendimiento,
  espaciado y cookies. Se reprodujeron los mismos 12 fallos en un worktree del
  commit inicial `9cc66b4`; no son regresiones de este cambio.
- Las 39 suites específicas de autenticación, correos, newsletter, reposición,
  perfil, campañas, pedidos y soporte pasan.
- PostgreSQL local `127.0.0.1:5433/cronox_dev`: migración aplicada y prueba de
  fixtures con diseños, firmas, colisiones y publicaciones; fixtures revertidos.
- SMTP efímero en loopback: remitente de sobre y autenticación No-reply para las
  tres finalidades, descuento conservado, historial sin secretos, verificación
  sin mensajes y presupuesto concurrente. Info, pedidos y soporte mantienen
  sus remitentes. Ningún correo externo.
- Cuentas locales: contraseña generada válida para login, contraseña existente
  intacta, despacho concurrente, reintentos, SMTP incierto, estados pendientes,
  enlace válido/usado/caducado/alterado y sesiones; establecer/cambiar contraseña.
- Perfil a 1366 y 390 px: ambos estados, ojos, seis/siete caracteres, errores,
  CSRF, doble envío, confirmación y ausencia de desbordamiento. Capturas locales
  en `output/playwright/profile-password-*.png`.
- Newsletter: 28 pruebas de la ejecución inicial aprobadas; las dos pruebas de
  acceso móvil requerían cerrar el aviso de cookies. Tras corregir la preparación,
  las cuatro pruebas de acceso pasan en Chromium y WebKit.

Reproducción (sin integraciones reales):

```powershell
npm run build:compiled --prefix cronox-backend
npm run admin:build
node cronox-backend/scripts/verify-mail-migration-local.cjs
node cronox-backend/scripts/verify-mail-purposes-local.cjs
node cronox-backend/scripts/verify-newsletter-jobs-local.cjs
npm test --prefix cronox-backend -- --runInBand
npx playwright test --config playwright.newsletter.config.cjs
# Para el perfil, arrancar el servidor estático tests/cart/server.cjs y ejecutar:
npx --package @playwright/cli playwright-cli -s=cronox-password open http://127.0.0.1:4173/profile.html
npx --package @playwright/cli playwright-cli -s=cronox-password run-code --filename=tests/password-visibility/profile-review.js
```

## Publicación pendiente

No se ha hecho push, despliegue ni migración de producción. Para publicar:
respaldar la base, detener los trabajadores durante el cambio, aplicar la
migración junto con esta versión, revisar las publicaciones alternativas y
confirmar los límites y credenciales ya configurados de No-reply. Compilar y
servir los recursos actualizados, incluyendo sus versiones de caché. Después,
reactivar únicamente los trabajadores vigentes y revisar las entregas inciertas
manualmente, sin reanudarlas en bloque. Conviene resolver por separado las
12 pruebas anteriores pendientes de frontend.
