# Preparación y conexión de los buzones

Actualización del 03/10/2026: el operador confirma TLS y autenticación IMAP/SMTP de los cuatro buzones en local y autoriza publicar correo, conciliación de visitantes y Home. La primera fase de producción mantiene envíos y avisos desactivados; solo Soporte podrá sincronizar cuando los cuatro diagnósticos desde el VPS sean correctos. Esta autorización sustituye las restricciones de publicación de la preparación anterior. Las comprobaciones locales no acreditan todavía la conexión desde el VPS.

Estado del 02/10/2026: preparación local terminada; ninguna conexión real comprobada, ningún correo enviado y ningún mensaje del proveedor modificado. Se conserva el trabajo anterior de visitantes, finanzas, correo y Home. No hay commit, push, despliegue ni migración de producción en esta preparación.

## Entorno local preparado

El arranque normal carga **`.env.local`**, no la base remota de `.env`. Las claves AES-256-GCM y VAPID están únicamente en ese archivo privado, ignorado por Git. El almacenamiento está en `%LOCALAPPDATA%\CRONOX\mailboxes`, fuera del checkout y del frontend. La ACL permite al usuario actual, SYSTEM y Administradores; la prueba de lectura/escritura se elimina al terminar. Las claves privadas nunca se imprimen.

El preparador es idempotente: conserva las claves y sus identificadores, el par VAPID y la ruta ya configurados. Si encuentra material existente incoherente o una clave privada perdida, falla; no lo sustituye silenciosamente. Desactiva `MAILBOX_WORKER_ENABLED` y `MAILBOX_SEND_ENABLED`. El arranque local también rechaza esas flags en true y mantiene correo transaccional y trabajos desactivados.

`MAILBOX_LOCAL_SMTP_REFERENCES=true` permite **solo al perfil local** resolver los cuatro pares `SMTP_*_USER`/`SMTP_*_PASS` actuales desde `.env` al arrancar. No guarda otra copia de las contraseñas ni habilita el correo transaccional. Después de actualizar una contraseña en `.env`, reinicia el backend local; no hace falta cambiar el buzón ni escribirla en el panel. La configuración del VPS sigue siendo independiente.

| Buzón detectado local y VPS | Referencia IMAP y SMTP |
|---|---|
| support@cronox.es | `SMTP_SUPPORT_PASS` |
| orders@cronox.es | `SMTP_ORDERS_PASS` |
| no-reply@cronox.es | `SMTP_NOREPLY_PASS` |
| info@cronox.es | `SMTP_INFO_PASS` |

Ambos entornos tienen `SMTP_HOST=smtp.hostinger.com`: se prepararon con Hostinger Email, IMAP 993/TLS y SMTP 465/TLS. La prueba real pendiente confirmará que el producto y la autenticación coinciden. Las referencias pueden compartirse entre IMAP y SMTP; el backend lee su valor actual. No se presupone una quinta dirección.

Los cuatro registros locales tienen `active=false`, `notify=false`, `PENDING_CONFIG` y ninguna credencial copiada a la base. No se modifican buzones existentes al repetir el registro. Las migraciones locales están al día. Fue necesario aplicar las cuatro pendientes locales revisadas: nota de inventario, histórico permanente, correo y conciliación de visitantes. La última se adaptó para revocar permisos de `anon`/`authenticated` únicamente cuando esos roles existen; una transacción local fallida quedó revertida y se reaplicó sin reset ni pérdida de datos.

Para repetir únicamente la preparación, desde la raíz:

```powershell
node cronox-backend/scripts/prepare-mailboxes.cjs
```

Para registrar las direcciones detectadas en otra instalación local, primero verifica el perfil local y aplica las migraciones mediante `npm run migrate:local --prefix cronox-backend`; después:

```powershell
node cronox-backend/scripts/prepare-mailboxes.cjs --register-local
```

Ese registro exige el perfil de desarrollo con PostgreSQL loopback y no tiene una opción para escribir en producción.

## Revisar el panel y probar una sola cuenta

1. Ejecuta `npm run admin:watch` desde la raíz y, en otra terminal, `npm run start:dev --prefix cronox-backend`. Entra en `http://localhost:3000/admin.html` con la cuenta local `admin@cronox.local`; su contraseña permanece en `LOCAL_ADMIN_PASSWORD` del archivo privado.
2. Abre **Correo**. Deben verse cuatro buzones, cifrado/ruta configurados, sincronización y envíos desactivados. Los ceros de mensajes describen una caché aún vacía; no significan que Hostinger no tenga mensajes.
3. Selecciona **Soporte** y abre **Configuración**. Comprueba dirección, producto, servidores y `SMTP_SUPPORT_PASS` en ambos campos de referencia. Conserva vacíos los campos de contraseña nueva y el buzón inactivo. La configuración abre el buzón seleccionado; también puedes elegir otro en sus botones.
4. Cuando decidas iniciar la conexión real, pulsa **Probar IMAP y SMTP sin enviar correo** únicamente para Soporte. Es una conexión real al proveedor: verifica TLS/autenticación y lista carpetas; no envía, descarga cuerpos ni marca mensajes. No exige activar la sincronización. Ningún resultado de esta prueba se ha obtenido durante esta preparación.
5. Si falla, revisa el código por protocolo, el producto en hPanel y la referencia actual en el entorno privado. No pegues contraseñas en el chat ni actives el buzón hasta que ambos protocolos pasen. No cambies las claves de cifrado para resolver un rechazo de contraseña.
6. Repite la prueba para los otros tres, uno cada vez. No hay que crear carpetas manualmente: se descubren del proveedor al sincronizar; selección de carpeta y copia en Enviados reutilizan las existentes.
7. La sincronización real se habilitará posteriormente en producción: activa solo Soporte en el panel y su opción de avisos si la quieres; deja los otros tres inactivos y el envío global en false. La importación de metadatos no marca leídos. **Abrir un mensaje sí lo marca leído**; no lo hagas durante una prueba que deba conservar sus flags.

Las dos autorizaciones globales son variables privadas del servidor, no interruptores modificables por el navegador. `MAILBOX_WORKER_ENABLED=true` permite el trabajador de sincronización/avisos; `MAILBOX_SEND_ENABLED=false` mantiene bloqueados los envíos. Solo después de revisar la sincronización puede habilitarse por separado el envío con `MAILBOX_SEND_ENABLED=true`; requiere también el trabajador operativo. `BACKGROUND_JOBS_ENABLED=false` bloquea el trabajador: conserva la política existente, sin activar otros trabajos de forma indiscriminada. ADMIN requiere permisos explícitos por buzón; SUPERADMIN configura; USER/FRIEND no acceden.

## Preparar el VPS antes de una publicación posterior

La inspección de lectura confirmó:

- Backend: `/var/www/cronox/Web_Cronox/cronox-backend`.
- `.env` pertenece a `deploy` y tiene modo 0600; no contiene variables `MAILBOX_*` en esta revisión. Las cuatro referencias y sus contraseñas están presentes, sin comparar ni imprimir sus valores.
- El proceso Node de producción corre como root bajo PM2. `deploy` solo tiene sudo para `pm2 restart cronox` y `pm2 save`; no puede inspeccionar la configuración PM2 de root. Por ello el procedimiento requiere una sesión administrativa del VPS para conservar también cualquier clave que exista únicamente en PM2.
- `/var/www/cronox/deploy.sh` actualiza main, instala dependencias, compila el panel, genera Prisma Client, ejecuta `prisma migrate deploy`, compila el backend y reinicia `cronox`. No sustituir este orden ni ejecutar migraciones de producción durante la preparación.

Procedimiento **para ejecutar después, con autorización de publicación**:

1. Desde esta copia local, copia únicamente el preparador público al lugar donde puede ejecutarse antes del despliegue. No copies `.env`, `.env.local`, claves, contraseñas ni almacenamiento:

   ```powershell
   scp -i "$env:USERPROFILE/.ssh/cronox_deploy" cronox-backend/scripts/prepare-mailboxes.cjs deploy@69.62.109.75:/var/www/cronox/Web_Cronox/cronox-backend/scripts/prepare-mailboxes.cjs
   ```

2. En una sesión root del VPS, ejecuta:

   ```bash
   cd /var/www/cronox/Web_Cronox/cronox-backend
   node scripts/prepare-mailboxes.cjs \
     --env-file=/var/www/cronox/Web_Cronox/cronox-backend/.env \
     --private-dir=/var/lib/cronox/mailboxes \
     --runtime-pm2=cronox
   ```

   La inspección de PM2 exige root y un daemon root ya existente. El preparador rechaza otro usuario o un daemon ausente antes de invocar PM2; no crea un daemon bajo deploy. Los escalares VAPID se codifican siempre como 32 bytes, también si contienen ceros iniciales, conservando su identidad criptográfica.

   No necesitas generar claves ni crear carpetas manualmente. El script lee la configuración PM2 sin imprimirla, conserva sus claves existentes, genera únicamente material ausente, prepara automáticamente el volumen con modo 0700, mantiene el propietario original de `.env`, lo deja en 0600 y verifica acceso como el usuario actual del backend. La ruta está fuera del repositorio y de recursos públicos; sobrevive a su actualización. Los archivos del módulo se crean en 0600 y cifrados. Si posteriormente cambia el usuario del backend, adapta propietario/ACL antes del arranque.

   Si encuentra discrepancias entre PM2 y `.env`, otro archivo activo mediante `CRONOX_ENV_FILE` o flags activas heredadas de PM2, se detiene con un código concreto; revísalo privadamente en esa sesión administrativa. No regenera claves para ocultar un conflicto. No reinicia procesos, abre conexiones, migra ni registra cuentas en producción. Las contraseñas del VPS se conservan exactamente como están. Nest carga `.env` desde su directorio de trabajo, salvo `CRONOX_ENV_FILE`; las variables heredadas prevalecen sobre dotenv.

3. Conserva una copia cifrada del **mapa completo** `MAILBOX_ENCRYPTION_KEYS`, su identificador activo y el par VAPID en el mecanismo privado de custodia que ya utilices, separado de la base. No se configura aquí una nueva política de copias externas. Local y producción deben usar claves diferentes. Dentro de cada entorno deben permanecer estables entre reinicios/despliegues y ser compartidas por todas las instancias. En una rotación se añade otra clave y se conservan las anteriores hasta recifrar todos los datos. Cambiar VAPID requiere volver a suscribir los dispositivos.

   Para recuperar, detén el trabajador de correo, restaura privadamente el mapa original y sus identificadores, restaura los ficheros cifrados con sus `.meta` y sus registros correspondientes de base, verifica descifrado en el entorno recuperado y reactiva solo después. Generar otra clave no recupera credenciales, archivos ni suscripciones cifradas. Si se pierde la original, puede perderse ese acceso aunque la base siga intacta.

4. Revisa los archivos del commit futuro sin incluir el trabajo ajeno, secretos o `output/`. Están pendientes de publicación `20261002160000_admin_mailboxes` y `20261002200000_visitor_daily_reconciliation`; la de correo crea diez tablas privadas y sus índices/restricciones/RLS, sin borrar datos existentes. Las cascadas solo regulan futuras relaciones de las tablas nuevas. La conciliación conserva hechos anteriores. El histórico permanente ya se publicó; no debe reaplicarse ni reescribirse. Antes de publicar, comprueba el alcance de cualquier migración adicional que aparezca pendiente.
5. Ejecuta las comprobaciones, compila panel/backend y, con autorización posterior, commit/sync seguro en main. GitHub Actions invocará el despliegue existente; deja que aplique las migraciones antes del reinicio. Sigue el resultado de Actions y verifica salud, migraciones, recursos, permisos y estado pendiente de correo. No des por terminada la publicación solo por el push.
6. Como SUPERADMIN de producción, usa las cuatro sugerencias para guardar los buzones inactivos con sus referencias actuales, o solo Soporte inicialmente. No copies los registros ni las claves locales a producción. Prueba Soporte sin enviar. Después, activa únicamente ese buzón y cambia **solo** `MAILBOX_WORKER_ENABLED=true`, manteniendo `MAILBOX_SEND_ENABLED=false`; comprueba que PM2 no lo sobrescribe y reinicia por el procedimiento existente. Tras comprobar importación/carpetas/avisos, incorpora los demás uno a uno. Cualquier prueba real de envío requerirá una decisión posterior; esta tarea no envía mensajes.

## Notificaciones en el móvil

1. Después de publicar y comprobar Soporte, abre el administrador por HTTPS con una cuenta que tenga permiso para ese buzón. Un teléfono no puede acceder al `localhost` de este PC: las claves y la suscripción que utilice serán las de producción.
2. Android: usa un navegador compatible con Web Push y permite las notificaciones del sitio. iPhone/iPad: iOS/iPadOS 16.4 o posterior, Safari → Compartir → Añadir a pantalla de inicio; abre el icono instalado.
3. Correo → Notificaciones: asigna un nombre al dispositivo, selecciona solo Soporte y pulsa **Activar o actualizar notificaciones**. Acepta el permiso del sistema. Deja los detalles desmarcados inicialmente para que el aviso sea genérico. Activa también los avisos del buzón y los permisos de aviso del ADMIN si lo usas.
4. Comprueba que aparece el dispositivo activo y que el permiso del sistema sigue permitido. Para verificar entrega real, espera a un **mensaje nuevo recibido normalmente después de la activación**; esta preparación no provoca correos ni avisos reales. La importación antigua no debe producir una ráfaga de notificaciones. Comprueba el aviso con el panel cerrado o el teléfono bloqueado; tocarlo abre CRONOX y comprueba la sesión/permisos. Abrir el mensaje puede marcarlo leído.
5. Si no llega, revisa trabajador/buzón/avisos, HTTPS, sesión y dispositivo activos, permiso del sistema, conexión y ahorro de batería. Los avisos dependen del navegador y del sistema; no se promete inmediatez. Una VAPID nueva obliga a suscribirse de nuevo; una sesión cerrada o permiso revocado impide el acceso.

No se ha comprobado todavía la recepción en un móvil físico ni el push real del VPS. Fuentes de soporte: [WebKit: Web Push para aplicaciones de inicio en iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) y [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
