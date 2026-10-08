# Numeración consecutiva de usuarios — implementación local, 8–9/10/2026

## Estado y alcance

Preparado y comprobado **solo en local**, sin commit, push ni operaciones en producción. Se preserva el trabajo anterior. Se revisaron las instrucciones del repositorio y sus ascendientes: no hay `AGENTS.md`; el archivo global de instrucciones está vacío.

La base local habitual `127.0.0.1:5433/cronox_dev` tiene **1 usuario**, no 42. Se respaldó y restauró el respaldo antes de aplicar las migraciones y el plan local: ID real 1, `CRX-000001`, siguiente ID 2. Se comprobaron 478 referencias de titularidad sin cambios. **No se ha consultado el número de usuarios de producción en esta tarea.** El operador obtiene el total real y rechaza cualquier total esperado diferente; nunca presupone 42 ni recrea cuentas borradas.

Las pruebas representativas usan PostgreSQL 17 aislado y usuarios sintéticos `@example.test`. No generan correos, tráfico de presencia ni estadísticas de producción.

## Resultado y garantías

`User.id` se modifica realmente. El mapa se calcula en PostgreSQL mediante `row_number() OVER (ORDER BY "createdAt", id)`, manteniendo la precisión almacenada de fecha/hora y el ID anterior como desempate. Se asignan los números 1…N y `memberCode` con el formato CRX existente. No se modifican contraseñas, correo, perfil, roles, fecha de alta ni tokens QR de las cuentas conservadas.

`identityUid` es una identidad interna auxiliar e inmutable. No sustituye el número solicitado: permite comprobar quién es el titular cuando el número cambia o se reutiliza. Las referencias a usuarios en el administrador incluyen ambos valores; una URL numérica antigua o una selección masiva con UUID diferente devuelve 409, en lugar de abrir/modificar otra cuenta. Los enlaces antiguos sin UUID deben abrirse de nuevo desde el listado.

Las concesiones de permisos de buzón también validan el UUID del ADMIN seleccionado. El formulario rechaza una configuración cacheada cuya identidad no coincide con el listado actual, sin trasladar permisos a otro administrador. Las descargas de adjuntos revalidan primero la sesión bajo bloqueo compartido y luego el acceso al buzón, sin temporizadores solapados.

La lista empieza por fecha de alta ascendente, con ID ascendente como desempate. `registrationNumber` y N.º son el ID real, sin `row_number` de resultados filtrados. Buscar CRX-000010 mantiene N.º 10, aunque solo quede una fila. Los filtros, la paginación y otras ordenaciones no cambian el número asignado.

La renumeración no se ejecuta durante consultas. `UserNumberingState` proporciona una asignación transaccional de ID y código en cada alta, incluido prerregistro por newsletter y alta al completar una compra. Las altas concurrentes se serializan; un rollback no consume un número. La secuencia SQL queda ajustada, pero el contador transaccional es la autoridad. La fecha de registro y el UUID son inmutables; un alta retroactiva requiere un procedimiento de importación controlado.

## Auditoría de referencias

Se revisaron esquema Prisma, migraciones, SQL, autenticación, pedidos/pagos, perfiles, códigos, membresía, favoritos, newsletter, analítica, workers, enlaces y cachés del navegador. El manifiesto privado de **cada** respaldo contiene el mapa completo, inventario real del esquema y referencias por fila/columna/ruta JSON, asociadas a UUID. No se publica ese manifiesto ni datos personales en este informe.

| Tipo | Referencias del esquema local revisado |
| --- | --- |
| 27 columnas con FK a User | Address; AdminNote.authorAdminId; AnalyticsSession; AuditLog.actorId; AuthSession; Cart; CheckoutSnapshot; CirclePromotionRequest; CircleUpgradeRequest.userId/processedById; CustomerActivityEvent; DailyVisitor; DiscountCode; EmailChangeRequest; Favorite; NewsletterMailJob; NewsletterSubscription; Order.userId/recordedById/voidedById; PasswordResetToken; PreRegistration; PromoCodeRedemption; RestockRequest; StockMovement; UserLoginEvent; historial. |
| 21 columnas sin FK | AdminBulkOperation.actorId; EmailAsset.createdBy; EmailSignature.createdBy/updatedBy; EmailTemplateVersion.createdBy; FooterPageContent.updatedBy; FooterSettings.updatedBy; GallerySettings.updatedBy; KeyScreen.createdBy/updatedBy; KeyScreenSettings.updatedBy; LivePresence.userId; MailboxAudit.userId; MailboxDraft.userId; MailboxPermission.userId; MailboxPushDevice.userId; MailboxSend.userId; ManagedEmailTemplate.createdBy/updatedBy; NewsletterSettings.updatedBy; PromoCode.ownerUserId. |
| Destinos semánticos | AdminNote.targetId y AuditLog.targetId **solo** cuando targetType es user. |
| 23 columnas JSON revisadas | AdminBulkOperation.result; AuditLog.metadata; CheckoutSnapshot.billingAddr/shippingAddr; EmailSignature.document; EmailTemplateVersion.snapshot; FinanceArchive.snapshot; FinanceArchiveRevision.snapshot; FinanceEventArchive.snapshot; FinanceStockArchive.snapshot; GalleryAsset.variants; GalleryCarouselSlot.relatedProductIds; MailboxCampaign.snapshot; MailboxCampaignDelivery.content; MailboxCampaignVersion.content; MailboxDraft.campaignEvent; MailboxMessage.envelope; MailboxPushEvent.payload; ManagedEmailTemplate.document; Order.billingAddr/shippingAddr; ProductImage.variants; WebsiteMediaAsset.variants. |

Las FK se actualizan con `ON UPDATE CASCADE`. En JSON se reescriben únicamente campos identificados como referencias de cuenta (`userId`, `actorId`, `authorAdminId`, `ownerUserId`, `processedById`, `recordedById`, `voidedById`, `createdBy`, `updatedBy` y arrays `userIds`). Se trata también `id` en filas de resultados masivos de usuarios, con su discriminador explícito. No se reinterpretan números de productos/pedidos, texto libre ni contenido de correos.

`CountedDailyVisitor` es una vista: se actualiza la tabla base, nunca la vista. Se detectó en el esquema local histórico que DailyVisitor no propagaba UPDATE, pese al esquema Prisma; una migración nueva corrige esa FK. Las migraciones aplicadas anteriormente no se editaron.

Las reservas antiguas `UserIdentityReservation` permanecen como historial congelado, sin controlar los nuevos números. `UserIdentityRegistry` impide reutilizar UUID y tokens QR, incluidos tokens de cuentas eliminadas. Los mapas de ejecuciones y las claves de referencias retiradas son históricos inmutables, excluidos de las reescrituras.

Stripe vincula el pago al identificador opaco de CheckoutSnapshot y al PaymentIntent verificado, no al antiguo número enviado por el navegador. El usuario de esa instantánea se actualiza mediante FK. Los fingerprints de checkout no conceden acceso a una cuenta: la titularidad se comprueba también contra el carrito/instantánea persistidos.

## Operación, concurrencia y autenticación

El operador adquiere el bloqueo exclusivo PostgreSQL `(824031, 1)` y, dentro de una transacción, bloquea las tablas base de `public`. Verifica de nuevo mapa, total, esquema, hash del respaldo y titularidad. Cambia IDs/códigos mediante dos fases, con números negativos temporales para evitar colisiones. Esos valores nunca se exponen por HTTP. Antes del COMMIT comprueba IDs consecutivos, códigos y la misma titularidad por UUID. Cualquier divergencia aborta y revierte los cambios.

Las peticiones API/webhooks adquieren el bloqueo compartido **antes de autenticar** y lo mantienen hasta terminar el handler. Un cliente desconectado no libera el bloqueo mientras su operación continúa. Los workers que manejan usuarios mantienen el mismo bloqueo durante su trabajo, sin acumular ticks pendientes. Las escrituras de analítica asociadas a acciones ya no quedan fuera del handler. La tarea diferida de recuperación de contraseña recupera el titular por UUID después de obtener su bloqueo.

La primera aplicación exige parar **todos** los escritores: el backend publicado anterior todavía no tiene este mecanismo. Las tareas externas, SQL manual o procesos ajenos a Nest también deben detenerse. Para el bloqueo del backend se necesita una conexión directa o de pool en modo sesión a **la misma base**; el pool de transacciones Supabase `:6543` se rechaza. `.env.example` documenta `USER_NUMBERING_DATABASE_URL`; el perfil local fuerza su propia conexión local.

Cada renumeración efectiva, incluidas eliminaciones controladas:

- Revoca todas las AuthSession, también las de cuentas cuyo número no cambió, e incrementa sessionVersion. Access/refresh tokens antiguos quedan rechazados; será necesario iniciar sesión de nuevo.
- Expira enlaces pendientes de cambio de correo, desactiva dispositivos push y limpia la presencia temporal. No borra visitas diarias ni totales históricos.
- Conserva los tokens opacos de recuperación de contraseña y lanzamiento ligados por FK a su titular original, y conserva los QR originales. Un QR retirado no puede validarse como una cuenta nueva.
- Usa UUID para las cachés de analítica y preferencias de perfil. Limpia la caché al finalizar sesión y descarta respuestas tardías del usuario anterior.
- Mantiene los hashes ya persistidos de visitantes diarios. Las identidades nuevas usan UUID, y una visita del mismo día tras renumerar reutiliza su fila existente; reutilizar un número de una cuenta eliminada no fusiona visitas.

Las tablas auxiliares y funciones de operación no son RPC públicos: RLS activado y permisos retirados de PUBLIC, anon y authenticated, sin SECURITY DEFINER. El operador requiere las credenciales de base de datos autorizadas para administrar este esquema.

## Eliminaciones futuras

No se añadió un botón de borrado ni se alteraron los permisos del panel. La eliminación física se realiza con el mismo operador, un respaldo nuevo restaurado, el total esperado y **UUID**, nunca solo un número. `DELETE User` fuera del procedimiento se rechaza. Un trigger de sentencia compacta las cuentas restantes dentro de la misma transacción. El operador protege al último ADMIN/SUPERADMIN activo.

Los pedidos y checkouts liquidados se conservan al borrar su cuenta: su FK queda NULL y `UserRetiredReference` conserva tabla, clave del registro, columna y UUID del titular eliminado. Las notas mantienen además `authorIdentityUid`. Los registros personales con CASCADE siguen las reglas del esquema; la comprobación de titularidad excluye únicamente la identidad borrada y las filas eliminadas por esas cascadas. Ninguna referencia de otra cuenta puede cambiar de titular.

Las referencias históricas obligatorias sin FK de borradores, envíos, operaciones masivas y dispositivos push usan **0 como propietario retirado**, que nunca es un User real ni una clave del mapa. El archivo privado conserva el UUID original; los permisos de correo de la cuenta borrada se retiran. Las referencias opcionales huérfanas quedan NULL y los destinos/JSON de cuenta retirados usan `deleted:<número>`, sin enlaces funcionales a una cuenta nueva. Si el propietario ya faltaba antes de instalar esta mejora, no se inventa un UUID: se conserva la referencia anterior en el archivo y el respaldo.

Los códigos personales de una cuenta borrada se desactivan para que un `ownerUserId` retirado no los convierta en códigos públicos. Las campañas con propietario retirado se mantienen inactivas sin consultar una cuenta con el número reutilizado. Un checkout sin pedido que no esté en un estado terminal impide borrar: antes debe completarse o cancelarse mediante el flujo de pagos existente, y después se prepara otro respaldo. No se cancela un pago real mediante una modificación SQL de estado.

## Verificación local

| Comprobación | Resultado |
| --- | --- |
| PostgreSQL 17 real aislado, esquema histórico, vista derivada y FK histórica | Correcto. |
| Mapa con huecos y fechas empatadas | IDs anteriores 18, 2, 10, 4, 25 → 1, 2, 3, 4, 5. Los antiguos 2/10 tienen la misma fecha y mantienen ese desempate. |
| Recuperación del respaldo | Dump custom de public restaurado en clúster vacío; mapa y hash de titularidad coinciden. Se verifica antes de schema, renumeración y borrado. |
| Total/mapa adulterados | Rechazados, sin cambios parciales. |
| Relaciones, notas, códigos, actividad, favoritos y JSON | Mismo UUID propietario; números de pedido/producto y tokens opacos sin alteración. |
| Sesiones antiguas y UUID incorrecto | Access/refresh rechazados, incluso con ID sin cambios; URLs/acciones/selecciones masivas obsoletas bloqueadas. |
| Concurrencia | Bloqueo exclusivo espera a trabajos compartidos; cuatro altas concurrentes reciben 7–10; rollback no deja huecos. |
| Eliminación y nuevo registro | 10 usuarios → 9 consecutivos; siguiente alta 10/CRX-000010. Se conserva historial de pedidos/correos y autoría por UUID. |
| Pago pendiente y código personal retirado | Borrado aborta íntegramente si hay checkout pendiente; promoción del titular borrado desactivada. |
| Visitantes diarios | Sin doble conteo tras renumerar ni fusión con la cuenta cuyo número se reutiliza. |
| HTTP Nest real | Inicio de sesión, /api/me, cambio de perfil, alta, administración, filtros y segunda página correctos. Sesión antigua 401; enlace/nota obsoletos 409. |
| Newsletter | Cuatro suscripciones concurrentes al mismo correo crean una cuenta; altas siguientes 12/13 sin huecos. Sin enviar correos. |
| Navegador Chromium | Escritorio 1440×1050 y móvil táctil 390×844: lista cronológica, filtro conserva N.º 10, Ver abre el detalle del mismo titular; ID interno 10 y CRX-000010. Enlace numérico antiguo muestra aviso, con cero consultas de detalle. |

Comandos de verificación utilizados:

```powershell
npm run prisma:generate --prefix cronox-backend
npm run build:compiled --prefix cronox-backend
npm run admin:build
npm test --prefix cronox-backend -- --runInBand
node --test cronox-backend/scripts/check-user-numbering-release.spec.cjs cronox-backend/scripts/start-local.spec.cjs
node cronox-backend/scripts/review-user-numbering-local.cjs
node cronox-backend/scripts/check-user-numbering-release.cjs --local
git diff --check
```

El recorrido PostgreSQL termina con 13 cuentas de prueba y detiene su servidor/clúster. Las capturas son de la fase visual con 13 cuentas sintéticas. Se verificaron Prisma, builds y sintaxis de los scripts de despliegue; las versiones de caché de API, administrador, detalle, bulk, perfil y analítica se incrementaron.

Resultado final de Jest: **211 suites y 1.996 pruebas**; comprobaciones Node del perfil local/despliegue: **5 pruebas**. Se añade también protección de identidad para permisos de correo y se incrementa `admin-inbox.js` a v13.

La aplicación local habitual quedó reiniciada con la compilación final: `/api/health` y `/api/ready` devuelven 200; `USER_NUMBERING_RELEASE_READY` confirma las cinco migraciones, estado ready, máximo/total 1, código correspondiente y siguiente ID 2. Los clústeres y navegadores de revisión de esta tarea quedaron cerrados. HEAD sigue en `54c0ca95ac239761ed92cf568a0b1734352f0df6`; los cambios de esta implementación permanecen sin commit, como se solicitó.

| Captura | Archivo local |
| --- | --- |
| Lista de escritorio | [desktop-list.png](../output/playwright/user-numbering/desktop-list.png) |
| Filtro: N.º 10 permanece 10 | [desktop-filtered.png](../output/playwright/user-numbering/desktop-filtered.png) |
| Enlace antiguo bloqueado | [desktop-old-link.png](../output/playwright/user-numbering/desktop-old-link.png) |
| Lista móvil | [mobile-list.png](../output/playwright/user-numbering/mobile-list.png) |
| Detalle abierto con toque | [mobile-detail-touch.png](../output/playwright/user-numbering/mobile-detail-touch.png) |

Respaldos locales privados bajo `output/private-user-numbering/`, excluidos de Git. El respaldo usado para numerar el usuario local fue `local-before-renumber-v3-2026-10-09`, SHA-256 `814f6a2a2297334045d708f23027e002c809d9f292349ca6ce557477331e8bb5`, restaurado y aplicado con total 1, ejecución `9e9589e9-5b48-417b-a460-933fe90c6257`. También se verificaron los respaldos anteriores a las migraciones de referencias retiradas y conservación de pedidos. Los intentos previos abortados por la vista/FK no dejaron IDs parcialmente cambiados; se corrigieron mediante migraciones nuevas y respaldos nuevos.

## Aplicación pendiente en producción: procedimiento exacto

### Precomprobación autorizada del 9 de octubre

La lectura de producción confirma **42 usuarios actuales y máximo ID 44**. Se ha preparado el mapa completo según `createdAt` e ID anterior: las 42 cuentas requieren cambiar de número. No se han aplicado migraciones ni renumerado cuentas en producción.

El respaldo preliminar está fuera del checkout y del webroot, en `/home/deploy/cronox-release-backups/user-numbering-preflight-20261009`, con permisos privados. SHA-256 del dump: `4a47f9ea333f3e42ba136750fe141c38e9b43a801d6fbf58a31f6341b020783d`. Se restauró de verdad y se verificó el mapa de las 42 cuentas en PostgreSQL 18.6 aislado, sin workers. La comprobación final empleó un socket Unix dentro de un directorio privado y sin escucha TCP. Este respaldo preliminar no sustituye los dos respaldos requeridos durante mantenimiento.

El verificador admite instalaciones Linux que separan los binarios de servidor y cliente: los clientes no presentes en `--pg-bin` se resuelven desde PATH y deben ser compatibles. En este VPS, el servidor aislado está en `/tmp/cronox-session-pg/unpacked/usr/lib/postgresql/18/bin` y los clientes PostgreSQL 18 están en `/usr/bin`. Se crean los roles vacíos `anon`, `authenticated` y `service_role` únicamente en la restauración aislada para resolver sus políticas; no se modifican roles de producción. La espera de arranque del HTTP de pruebas se amplió a 60 segundos para tolerar carga local.

Se repitió satisfactoriamente el recorrido PostgreSQL completo: cinco cuentas con huecos y fechas empatadas, relaciones FK/no FK/JSON, restauración de respaldos, sesiones antiguas, concurrencia, altas, borrado y flujos HTTP reales; termina con 13 cuentas sintéticas. Los builds de administrador y backend, las tres pruebas del guard de despliegue y las **211 suites / 1.996 pruebas Jest** también pasan. Se habilita `workflow_dispatch` para poder ejecutar el despliegue controladamente después de la operación inicial.

**Bloqueo operativo:** el SSH `deploy` solo tiene sudo para `pm2 restart cronox` y `pm2 save`; no permite detener los escritores ni administrar el proxy. La clave disponible tampoco permite entrar como root. Se ha solicitado acceso operativo para mantenimiento y parada. No se debe publicar/aplicar la numeración ni invalidar sesiones mientras este bloqueo siga vigente. El workflow sigue activo y producción permanece en su revisión anterior.

**No ejecutado.** Requiere una publicación autorizada aparte y una ventana de mantenimiento. No basta con `prisma migrate deploy`: la preparación del esquema no renumera los datos. El workflow comprueba el script de la revisión entrante **antes del merge que cambiaría HTML público**, y de nuevo antes de migrar/reiniciar. Rechaza un esquema sin la operación completa; una instalación antigua sin la dependencia pg también aborta, sin saltar la comprobación.

1. Desactivar temporalmente el workflow automático `Deploy CRONOX`. Preparar la revisión autorizada y sincronizar sin descartar trabajo. Activar mantenimiento en el proxy, detener PM2 `cronox` y cualquier otro escritor/worker. Evitar nuevas altas/pedidos; los webhooks deben recibir una respuesta reintentable mientras dure la operación. Mantener los procesos parados hasta validar el resultado.
2. Trabajar en `/var/www/cronox/Web_Cronox` con el operador autorizado. Preparar fuera del webroot una carpeta privada, acceso solo del operador (`umask 077`, permisos 0700; en Windows, ACL privada). Los dumps contienen datos personales, hashes y tokens; no subirlos a Git, ni servirlos por HTTP. Usar herramientas PostgreSQL compatibles con la versión del servidor. El verificador necesita `initdb`, `pg_ctl`, `psql`, `pg_dump` y `pg_restore`; debe ejecutarse como usuario **no root**, con capacidad de crear un clúster temporal en loopback. Ajustar `pg_bin` a la instalación real, por ejemplo `/usr/lib/postgresql/17/bin`.
3. Instalar las dependencias exactas de la revisión (`npm ci` en raíz y backend), sin arrancar Nest. Confirmar en el entorno privado que DIRECT_URL y USER_NUMBERING_DATABASE_URL apuntan a la base correcta, mediante conexión directa o sesión. No imprimir sus valores. Si DIRECT_URL no está disponible, usar una variable privada explícita de conexión autorizada, cambiando el nombre en los comandos.
4. Antes de cualquier migración, obtener y restaurar un respaldo de public. En el directorio `cronox-backend`:

```bash
umask 077
pg_bin=/usr/lib/postgresql/17/bin
backup_before=/var/lib/cronox/private/user-numbering/before-schema-YYYYMMDD-HHMMSS
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --prepare --directory="$backup_before" --pg-bin="$pg_bin"
node scripts/verify-user-numbering-backup.cjs --directory="$backup_before" --pg-bin="$pg_bin"
```

Comprobar privadamente `plan.json`: total real, todos los pares oldId/newId y su `createdAt`. Si la restauración falla, detenerse; no editar a mano `restoreVerified`. Este respaldo contiene el esquema anterior y permite recuperar esa fase.

5. Con los escritores todavía parados, preparar el esquema y artefactos de la misma revisión:

```bash
npx prisma generate
npx prisma migrate deploy
npm run build:compiled
cd ..
npm run admin:build
cd cronox-backend
```

Las cinco migraciones nuevas de esta tarea son `20261008190000_consecutive_user_numbers`, `20261009010000_user_numbering_base_tables`, `20261009011000_daily_visitor_user_update_cascade`, `20261009020000_retired_user_references` y `20261009023000_deleted_account_order_history`. Si hay otras migraciones pendientes, revisar su procedencia antes de aplicarlas. Las altas quedan bloqueadas por ready=false hasta aplicar el mapa.

6. Preparar **otro** respaldo después de migrar, con UUID e inventario final; restaurarlo y revisar su mapa completo. No reutilizar un manifiesto del esquema anterior:

```bash
backup_apply=/var/lib/cronox/private/user-numbering/before-numbering-YYYYMMDD-HHMMSS
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --prepare --directory="$backup_apply" --pg-bin="$pg_bin"
node scripts/verify-user-numbering-backup.cjs --directory="$backup_apply" --pg-bin="$pg_bin"
expected_users="$(node -p 'require(process.argv[1]).total' "$backup_apply/plan.json")"
```

Confirmar el total obtenido y el mapa de los usuarios existentes. Si realmente son 42, el plan termina en 42; si son otra cantidad, usar esa cantidad. Ninguna cuenta eliminada aparece en el plan.

7. Aplicar y comprobar la operación atómica:

```bash
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --apply --directory="$backup_apply" --expect-users="$expected_users"
node -r dotenv/config scripts/check-user-numbering-release.cjs --deployment-check
```

Si cambió mapa/esquema/titularidad desde el respaldo, el operador aborta: investigar al escritor concurrente y obtener otro respaldo restaurado. No cambiar el total para forzar la ejecución. Repetir el mismo plan antes de nuevas escrituras es idempotente; un mapa que ya no corresponde se rechaza.

8. Arrancar la revisión compatible ya compilada (`sudo /usr/bin/pm2 restart cronox`, según los permisos operativos existentes, y `sudo /usr/bin/pm2 save`). Comprobar `/api/health` y `/api/ready`. Iniciar sesión nuevamente; validar lista cronológica, N.º/ID/código, filtros y páginas, perfil y pedidos del mismo titular. Contrastar máximos, total, siguiente ID y titularidad con el manifiesto privado. Probar que un enlace numérico anterior no abre otra cuenta. No crear pedidos/visitas sintéticos en producción para esta comprobación. Reabrir tráfico y workflow solo después de la validación.

### Borrado posterior autorizado

Volver a detener escritores, preparar otro respaldo con el esquema actual, restaurarlo y revisar mapa/total. Obtener el UUID del titular a borrar del manifiesto/listado actualizado y validar su identidad antes de ejecutar:

```bash
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --apply --directory="$backup_apply" --expect-users="$expected_users" --delete-uid=UUID_DEL_TITULAR_REVISADO
node -r dotenv/config scripts/check-user-numbering-release.cjs --deployment-check
```

El resultado debe tener N−1 usuarios y próximo ID N; vuelve a exigir inicio de sesión. No usar este comando con un respaldo de una operación anterior. Si hay pagos sin resolver o se borraría el último acceso administrativo, se bloquea sin cambios y hay que resolver esa condición por el flujo existente.

### Recuperación

Si falla antes del COMMIT, IDs y relaciones se revierten automáticamente y los procesos permanecen parados. Si hay que revertir una aplicación ya confirmada, mantener mantenimiento y todos los escritores parados: restaurar el dump verificado en una base vacía compatible y verificar mapa/titularidad con las herramientas proporcionadas; recuperar también la revisión de aplicación correspondiente a ese esquema antes de cambiar la conexión/arrancar. No restaurar ciegamente encima de pedidos nuevos. La recuperación del servicio y ACL requiere al administrador de la base; la prueba aislada usa `--no-owner --no-acl` precisamente para no modificar roles de producción. Conservar los respaldos de ambas fases. Al recuperar, revocar sesiones anteriores antes de reabrir tráfico; no reutilizar sesiones capturadas antes de una operación con números reutilizados.
