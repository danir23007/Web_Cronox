# METACRILATOS: ID público memberCode · 17/10/2026

## Cambio publicado

Versión de aplicación: `a49acfd99da26cb07b945eef432f0fa6e5501e1c`. El procedimiento confirmó la publicación el 17 de octubre de 2026 a las 03:34:07, hora de Madrid. Las auditorías posteriores pasaron.

- [CI del push](https://github.com/danir23007/Web_Cronox/actions/runs/38990665852): correcto; 249 suites y 2.600 pruebas generales, más 59 pruebas de exportaciones.
- [Verificación y despliegue](https://github.com/danir23007/Web_Cronox/actions/runs/38990677013): correctos.

La instrucción actual sustituye la anterior de imprimir `registrationNumber`. La etiqueta del reverso utiliza **`memberCode`**, recibido de la fila del usuario autenticado por `MembershipService.getMyAccreditation`, y lo presenta con el formateador existente `CRONOX_USER_IDENTITY.format(data)`. `CRX-000050` y `000007` se conservan literalmente, sin prefijos añadidos, ceros eliminados ni reconstrucción desde `User.id`.

La respuesta mantiene `registrationNumber`, `visibleId: identityUid` y todos los demás campos por compatibilidad. Perfil y preview cargan `user-identity.js` antes del renderer. La preview usa `memberCode: 'CRX-000050'` y número administrativo 23, con sus datos ficticios y QR inválido. El control de recursos incluye ahora el formateador.

Los códigos ausentes siguen el comportamiento existente: el formateador muestra `—`, sin fallback a número, UUID o token. El esquema nullable admite datos históricos; la provisión pertenece a los flujos existentes de alta/completado y numeración, que esta lectura no invoca ni modifica. Antes del despliegue se verificaron 51 usuarios con 51 códigos únicos y ninguno nulo, vacío o blanco. No se generan códigos para resolver una diferencia de presentación.

No cambian estilos, dimensiones, composición, textos exteriores, giro, controles, espera de siete segundos ni corrección WebKit. Se conservan códigos almacenados, identidades, tokens personales, payload y PNG del QR, relaciones e inscripciones. No se introduce ninguna migración. Cachés actualizadas: renderer `v=5` y preview `v=6`; el formateador existente sigue en `v=1`.

## Verificación local

- **71 pruebas Jest focalizadas aprobadas**: 51 de frontend/formateador/movimiento/presentación y 20 del servicio/contratos backend. Incluyen número de orden 1 frente a `CRX-000050`, `000007`, ausencia sin sustitución, parámetros falsificados ignorados, recarga y conservación de QR.
- Typechecks frontend/backend, ambas compilaciones, sintaxis, control de publicación y los cinco hashes aprobados/cuatro activos extraídos correctos.
- PostgreSQL desechable: cuatro usuarios comparados con sus códigos almacenados y pruebas de las reglas de renumeración ya existentes; se mantiene el payload y PNG exactos del QR. Autorización y concurrencia de Eventos QR pasan. No se renumeran cuentas locales ni productivas para este ajuste.
- **35 pruebas de navegador aprobadas**: 15 focalizadas de códigos/perfil/preview y 20 de renderer, geometría, recursos y lectura QR sin espejo. Chromium escritorio y 320/375/430 px, más WebKit iPhone simulado. Preview de los cinco círculos sin acceso a `/me` ni escrituras.
- Localhost con sesión y base reales: etiqueta igual al `memberCode` almacenado y distinto de la numeración administrativa; comparación SHA-256 del QR antes/después idéntica; todos los códigos, números, identidades, tokens, diseños y selección permanecen iguales. Diez combinaciones de preview, sin errores de página ni escrituras al manipular la muestra.

Las pruebas del ejemplo exacto número 1 / código `CRX-000050` y del código `000007` utilizan datos controlados. La cuenta local real conserva su código propio. No hay pruebas con dispositivos físicos.

## Verificación en producción

El workflow aprobó su verificación final, las compilaciones y los controles de publicación. Prisma encontró las 94 migraciones existentes y ninguna pendiente; el reinicio habitual de PM2 terminó con salud y disponibilidad correctas.

La verificación HTTP posterior confirmó **17 de 17 archivos idénticos a los blobs Git del commit publicado**, incluidas las nuevas versiones del renderer y la preview y el formateador compartido. El código servido usa `window.CRONOX_USER_IDENTITY.format(data)`; `/cuenta` y la preview tienen las referencias de caché actualizadas. Salud, disponibilidad y HTML responden correctamente; seis rutas privadas rechazan solicitudes sin sesión y administración redirige al login. La selección activa continúa siendo METACRILATOS.

La auditoría SQL con transacción `REPEATABLE READ READ ONLY` exigió el SHA exacto desplegado y comparó nombres, recuentos y digests completos de las 15 tablas protegidas. Usuarios, registro de identidades, códigos almacenados, tokens, diseños, selección, grupos/participantes QR, configuración e historial de migraciones permanecen idénticos. Se conservan **51 usuarios, 51 memberCode únicos y 51 tokens QR únicos**, sin códigos ausentes; no se renumeró ni regeneró ninguno.

La inspección visual autenticada se realizó en localhost. En producción se verificaron versión servida, referencias de caché, protección de rutas, disponibilidad y conservación de datos; no se realizó un recorrido autenticado de su interfaz ni se crearon sesiones artificiales.

Se conservan en el VPS las diferencias previas de dependencias históricamente versionadas y el archivo ajeno `cronox-backend/src/main.ts.cronox-before-stripe`; no se descartó ningún cambio. Se eliminó la sesión local temporal del navegador y no quedan servidores estáticos de pruebas en 4173. Localhost 3000 permanece disponible.

## Evidencias

Capturas locales privadas: `output/playwright/member-code-local-back-desktop.png`, `member-code-local-back-mobile.png` y `member-code-local-preview-cli-back-desktop.png`. La preview está marcada como muestra y su QR carece de validez. No se publican los QR personales como activos de la web.

Informe local: `output/metacrilatos/release/member-code-local-qa.json`. Informe HTTP: `output/metacrilatos/release/member-code-http-after-a49acfd99da2-1792200863053.json`. Herramientas y reportes bajo `output/metacrilatos/release/member-code-*`, ignorados por Git. Snapshots de producción en `/home/deploy/cronox-release-backups/metacrilatos-member-code/{before,after}.json`, directorio 700 y archivos 600; contienen solo recuentos/digests y metadatos de auditoría, nunca códigos personales ni tokens.

Este informe se incorpora mediante un commit documental posterior al despliegue. Los cambios exclusivos de `docs/` no disparan otro despliegue ni cambian el código de aplicación ejecutado.
