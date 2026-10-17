# METACRILATOS: columna compacta, STATUS e ID visible · 17/10/2026

## Publicación

Versión de aplicación: `b67727541545a33bfb33066ac648bb44d31ba9c1`. El procedimiento confirmó el despliegue el 17 de octubre de 2026 a las 02:43:28, hora de Madrid.

- [CI del push](https://github.com/danir23007/Web_Cronox/actions/runs/38986617389): correcto.
- [Verificación y despliegue](https://github.com/danir23007/Web_Cronox/actions/runs/38987119784): correctos; disponibilidad posterior y auditorías de producción aprobadas.

Este informe se incorpora mediante un commit exclusivamente documental después de comprobar el despliegue. No requiere migraciones ni reinicios adicionales; el workflow excluye los cambios exclusivos de `docs/`.

## Cambios y conservación

En escritorio, la columna derecha reduce sus tipografías e indicadores al 90 % y compacta los espacios entre título, indicadores, privilegios e historial. Conserva todos los textos y cifras. El cálculo usa la altura de referencia anterior para mantener el tamaño aprobado del metacrilato y la posición de su botón; no remonta el renderer al medir o redimensionar. La cabecera, «Mi cuenta», pestañas y «Cerrar sesión» permanecen iguales.

El historial completo termina por encima del borde inferior del botón. «Volver a la tienda» sigue pequeño y centrado respecto al conjunto; se recupera el espacio inferior que queda libre. El copyright permanece fuera de la escala, a 10 px de los bordes izquierdo e inferior cuando la composición cabe.

La presentación compartida muestra literalmente **TU STATUS EN CRONOX**, también en la preview administrativa y en móvil. Los tamaños y la distribución móvil se conservan. No se cambian los cinco diseños, recursos aprobados, reflejos, geometría, colores de indicadores, protección del QR, giro, pausa de siete segundos ni corrección de WebKit. Tampoco se modifican el libro, Eventos QR o las reglas de selección.

La respuesta autenticada de `/api/membership/me/accreditation` incorpora `registrationNumber: user.id`. El reverso imprime exclusivamente ese número con el mismo formato decimal positivo que el N.º de Clientes → Usuarios. La propiedad anterior `visibleId: identityUid` mantiene su significado por compatibilidad, pero ya no se imprime. Un dato ausente o inválido se representa con un guion, nunca con un UUID recortado, token, memberCode o índice. La preview usa el número ficticio 23.

No se renumeran usuarios ni se regeneran tokens. Se conservan `identityUid`, `publicMemberToken`, payload y gráfico del QR, relaciones e inscripciones. Si cambia la numeración por las reglas ya existentes, la siguiente carga muestra el número actual y conserva el mismo QR. No hay cambios de esquema ni migraciones nuevas.

Referencias de caché: renderer `v=4`, presentación `v=2`, composición CSS `v=5`, ajuste exterior `v=3` y preview `v=5`.

## Alturas verificadas y límite explícito

La composición completa, el enlace y el pie caben en 1440×900, 1920×1080 y 2560×1440. En el círculo V, el historial termina en y=908,61 frente al borde inferior del botón en y=929,48 a 1920×1080; a 2560×1440, las posiciones son 1210,09 y 1243,36.

**1366×768 sigue necesitando desplazamiento vertical.** Antes de reducir la derecha, el botón aprobado ya terminaba en y=810,875, por el tamaño y posición de la propia tarjeta. Reducir solo el texto no permite incluir además el enlace y el pie dentro de 768 px. Se conserva la tarjeta y su control, y se permite scroll sin ocultar contenido. El círculo V ocupa un documento de unos 900 px; avisos adicionales pueden requerir más. Esta limitación se comunicó expresamente y no se declara ese tamaño como encajado. Se mantiene también el desplazamiento necesario en ventanas bajas y zoom elevado.

## Comprobaciones

- Suite general local: **249 suites y 2.596 pruebas aprobadas**. Typechecks y compilaciones frontend/backend correctos, junto con los controles de publicación, referencias y activos aprobados.
- Suite de navegador: **86 aprobadas, nueve omisiones intencionadas y cero fallos**. Las omisiones corresponden a cuatro repeticiones exclusivas de escritorio, cuatro repeticiones del recorrido con reloj real y un protocolo táctil de Chromium no disponible en WebKit.
- Auditoría visual de **80 combinaciones**: perfil y preview, cinco círculos y ocho tamaños. STATUS e ID correctos, QR decodificados sin espejo, historial completo antes del botón, sin desbordamiento horizontal ni escrituras por abrir o manipular muestras.
- Comparación contra `5191a54`: ninguna diferencia superior a 0,5 px en tarjeta, botón, cabecera y navegación de escritorio ni en la geometría móvil completa. Se conserva el giro completo, arrastre, gesto prolongado, espera desde soltar, resize y cierre/reapertura.
- Integración con PostgreSQL desechable: cuatro usuarios comparados con la lista administrativa real y nueva comparación tras la renumeración existente. Se exige el mismo payload y PNG QR antes y después; pasan también autorización, aislamiento y concurrencia de Eventos QR. Solo la rasterización del test unitario del servicio se simula para evitar dependencia de CPU; la integración compara PNG reales.
- Localhost con sesión y base reales: perfil, lista administrativa y diez combinaciones de preview. ID autorizado coincidente; todos los números, identidades, tokens, diseños y selección locales permanecen iguales antes y después. No hay escrituras desde la preview ni errores de página.

Los recorridos táctiles, cámara y tamaños móviles son simulados en motores automatizados. No se han probado teléfonos, cámaras ni Safari físicos. La revisión visual autenticada se realiza en localhost; la comprobación de producción cubre recursos servidos, protección, servicio y base de datos, sin crear sesiones ni trasladar credenciales locales.

## Comprobación posterior a la publicación

El workflow volvió a aprobar las 249 suites y 2.596 pruebas generales, las 59 pruebas de exportaciones, los controles de seguridad, los hashes de diseños y activos, los typechecks y ambas compilaciones. La precomprobación aislada de numeración y estado de cuenta pasó. Prisma encontró las 94 migraciones existentes y ninguna pendiente; PM2 reinició el servicio y confirmó salud y disponibilidad.

La comprobación HTTP posterior exige bytes idénticos a los blobs Git de `b67727541545a33bfb33066ac648bb44d31ba9c1`: **16 de 16 archivos coinciden**, incluidos código, plantilla, imágenes y lector QR. `/cuenta` y la preview contienen las nuevas referencias de caché; la presentación sirve STATUS y el renderer utiliza `registrationNumber`. Salud, disponibilidad y cuenta responden correctamente. Seis rutas privadas rechazan solicitudes sin sesión y administración redirige al login.

La auditoría de base usa una transacción `REPEATABLE READ READ ONLY`. Antes y después coinciden los nombres, recuentos y digests completos de las **15 tablas protegidas**: usuarios, registro de identidades, diseños y selección, grupos y participantes QR, historial Prisma y ocho tablas de configuración. El SHA del checkout coincide exactamente con la versión publicada. Se conservan los **51 usuarios y sus 51 tokens únicos**, todas las identidades, las 94 migraciones con sus checksums y la selección/configuración de METACRILATOS.

**METACRILATOS ya estaba activo por elección del usuario antes de esta publicación y sigue activo.** El informe de la primera publicación describe su selección histórica `original`; no se ha restaurado aquel valor ni copiado configuración local.

El informe HTTP privado es `output/metacrilatos/release/status-id-http-after-b67727541545-1792197853109.json`. Los snapshots de base están en `/home/deploy/cronox-release-backups/metacrilatos-status-id/{before,after}.json`, con directorio 700 y archivos 600. No se necesitó una migración ni se alteraron datos para verificar este ajuste.

Se eliminó el archivo temporal de sesión del navegador y se cerró el servidor estático de pruebas. El servidor local normal continúa disponible en el puerto 3000.

En el VPS se conserva el archivo ajeno `cronox-backend/src/main.ts.cronox-before-stripe` y las dependencias históricamente versionadas que regenera `npm ci`; no se ha usado reset ni se han descartado esos cambios. Fuera de `node_modules` no hay otras diferencias de producto en ese checkout.

## Evidencias locales privadas

Capturas finales con la cuenta local real:

- `output/playwright/status-id-local-profile-desktop.png` — 1920×1080.
- `output/playwright/status-id-local-profile-mobile.png` — 375×812, documento completo.
- `output/playwright/status-id-local-back-desktop.png` y `status-id-local-back-mobile.png` — ID y QR personal; no se publican como activos web.
- `output/playwright/status-id-local-preview-desktop.png`, `status-id-local-preview-mobile.png` y `status-id-local-admin-complete.png`.

Informes y herramientas ignorados por Git: `output/playwright/status-id-verification.json`, `output/metacrilatos/release/status-id-local-qa.json` y `output/metacrilatos/release/status-id-*`. No contienen credenciales publicables. Los snapshots de base permanecen privados en el servidor, fuera del repositorio, y solo registran recuentos y digests de datos, no los tokens ni datos personales.
