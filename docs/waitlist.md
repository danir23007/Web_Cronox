# Waitlist: avisos de reposición

## Alcance y funcionamiento

Implementación independiente del lanzamiento, newsletter y correos de pedidos. No modifica precios, reservas, movimientos de inventario ni pagos. No reserva unidades para los suscriptores.

La regla de compra encontrada en `CartService` y `OrdersService` exige producto activo, variante activa y `stockQty > 0`. Prisma mapea `stockQty` a la columna SQL `stock`. Las reservas de checkout **ya descuentan** ese stock: no se restan otra vez.

El cliente elige una talla en un bloque independiente de los botones de compra. Las tallas agotadas siguen sin poder comprarse. El acceso/registro existente se abre en la misma página; el parámetro `waitlist` conserva la variante y se requiere una nueva pulsación de confirmación al volver. La suscripción usa la identidad y correo de la cuenta, no un correo enviado desde el navegador. Una respuesta fallida no se presenta como éxito. La consulta persistente permite cancelar el aviso y recuperar su estado tras recargar u otro dispositivo.

Quick Add conserva la compra normal y ofrece un enlace al producto cuando hay tallas agotadas. Los enlaces del correo usan `FRONTEND_URL`, la ruta `/producto/<slug>` y `size=<código>`; sólo se preselecciona una talla comprable.

## Modelo y transiciones

`RestockRequest` guarda cada ciclo explícito y su resultado. La clave parcial única de PostgreSQL impide dos solicitudes activas de la misma cuenta/variante. Las peticiones se serializan con los cambios de inventario. Las solicitudes aceptadas y canceladas permanecen como historial, pero no cuentan como demanda activa.

La migración `20260925120000_restock_waitlist` es aditiva y posterior a `20260924120000_launch_campaign_state`. No carga eventos históricos ni cambia inventario. Los triggers actúan dentro de la transacción que actualiza el inventario: un rollback revierte también la programación.

- `WAITING`: solicitud activa, todavía sin oportunidad de disponibilidad.
- `QUEUED`: la variante pasó de no comprable a comprable; espera **cinco minutos continuos** de disponibilidad antes del envío.
- `PROCESSING`: un trabajador ha reclamado exclusivamente el aviso. Se vuelve a comprobar la cuenta, disponibilidad, configuración y apertura de la tienda antes de contactar con SMTP.
- `ACCEPTED`: SMTP aceptó el mensaje. La solicitud está cumplida; **no significa entrega en bandeja de entrada**.
- `FAILED`: rechazo definitivo o tres intentos seguros agotados; no se reintenta automáticamente.
- `UNCERTAIN`: resultado de SMTP desconocido o reclamación interrumpida durante más de 15 minutos; no se reenvía automáticamente.
- `CANCELLED`: solicitud cancelada. Una variante reutilizada para otro producto/talla cancela las solicitudes anteriores. La eliminación de cuenta/variante elimina sus solicitudes por FK.

Se observan todas las actualizaciones de las tablas, incluidas edición individual, guardado de variantes desde producto, ajuste manual, edición múltiple en Inventario y cualquier importación que use esas mismas tablas. No se ha encontrado un importador adicional de stock activo en `src`. También se observan los incrementos por devolución y liberación de reservas; **no se modifica ninguno de esos flujos**.

Política deliberada: una liberación de reserva o reactivación de producto/variante sí puede constituir una oportunidad, pero sólo si deja stock comprable durante cinco minutos. Otra falta de stock o desactivación devuelve los avisos en cola a `WAITING`. Un cambio positivo→positivo no crea otro aviso ni reinicia el plazo. No hay matrícula automática para ciclos posteriores: después de un envío aceptado, el cliente debe volver a solicitarlo cuando su talla se agote otra vez. Se considera a todos los clientes elegibles, aunque sólo se reponga una unidad.

Si el producto vuelve a agotarse justo después de la última comprobación puede llegar un aviso sin stock restante: no hay reserva ni transacción de base de datos abierta durante SMTP. El texto del correo lo advierte. Una cancelación gana frente a un aviso todavía en cola; cuando ya está en proceso, la API informa de que no puede detenerlo.

## Envío y recuperación

`WaitlistService` tiene un trabajador propio dentro del backend: cada diez segundos procesa hasta diez avisos, sin navegador. `FOR UPDATE SKIP LOCKED` y un token por reclamación permiten varias instancias sin reclamar el mismo aviso dos veces. Los estados sobreviven al reinicio. El trabajador no reconstruye eventos mediante un escaneo del stock actual.

El trabajador está **habilitado por defecto desde el primer despliegue**, también cuando `WAITLIST_EMAIL_WORKER_ENABLED` no existe. `.env.example` lo muestra explícitamente como `true`. Al arrancar el backend se registra el temporizador; la primera comprobación ocurre a los diez segundos. No necesita activación desde el administrador.

Para enviar siguen siendo necesarios `EMAIL_ENABLED=true`, configuración SMTP existente, cuenta INFO completa y tienda abierta. La Pantalla Clave cerrada pausa los envíos: no se elimina esta protección por habilitar el trabajador. No se crean eventos históricos al desplegar ni al reiniciar.

**Interruptor de emergencia:** `WAITLIST_EMAIL_WORKER_ENABLED=false` desactiva el trabajador; reiniciar todas las instancias afectadas para cargar el cambio. `false` explícito prevalece sobre el valor por defecto. Se toleran mayúsculas/espacios en true/false; valores vacíos o no reconocidos desactivan por seguridad. El modo de comprobación `CRONOX_ROUTE_SMOKE_MODE=true` continúa desactivándolo. Inicio, procesamiento y estado del panel utilizan la misma regla.

Con el trabajador apagado se pueden registrar solicitudes y programar avisos, pero no enviarlos. Al volver a habilitarlo se procesarán los avisos en cola que sigan siendo elegibles; revisar esa cola antes. No se interrumpe un mensaje que ya haya entrado en SMTP.

El renderizador Handlebars existente escapa nombre/talla/URL. Se usa una plantilla dedicada `restock.hbs` y el transporte INFO, sin token de acceso, descuento ni publicación del lanzamiento. La imagen principal usa su versión `small` cuando existe; se omite del correo si no hay versión optimizada.

Sólo se reintentan rechazos SMTP explícitos temporales en comandos anteriores a la aceptación/final de DATA, o fallos de DNS/conexión rechazada. Máximo tres intentos por solicitud, con espera de 5 y 10 minutos. Los timeouts, desconexiones, resultados no reconocidos y fallos posteriores a la aceptación son inciertos. Un fallo de persistencia después de SMTP deja una reclamación que pasa a incierta; **no vuelve a la cola**. No se promete entrega exactamente una vez.

Los fallidos/inciertos se muestran al cliente y al administrador. No hay botón masivo para reenviarlos. Revisar los registros del proveedor fuera del navegador antes de cualquier intervención; no actualizar estados a ciegas ni relanzar inciertos. El cliente puede cancelar solicitudes no procesándose. Los logs nuevos sólo contienen códigos de resultado, no direcciones ni credenciales.

## Administración y seguridad

Waitlist está integrado en el panel existente y su API exige ADMIN/SUPERADMIN. Filtros de nombre, SKU, slug/ID, talla y estado, orden por demanda, páginas de 25 tallas y actualización automática cada 30 segundos mientras el apartado está visible. No ofrece edición de stock.

La demanda por talla cuenta personas con solicitud activa: espera, cola, proceso, fallo o incertidumbre. Los resultados de envío se detallan aparte. Las personas distintas del producto se calculan entre todas sus tallas y **no deben sumarse por fila**. No se muestran correos ni datos personales de compradores. Los totales de entrega son ciclos de solicitud, no personas.

La API de cliente sólo consulta/modifica solicitudes de la identidad autenticada. Conserva CSRF, validación y límites de peticiones. La tabla tiene RLS y revoca acceso público/anon/authenticated. El rol de conexión del backend debe tener permisos de servidor (propietario o rol autorizado); no conceder acceso directo a los clientes de Supabase.

## Verificación local, sin correo ni base remota

Desde la raíz del repositorio:

```powershell
npm run admin:build
npm run build --prefix cronox-backend
npm test --prefix cronox-backend -- --runInBand --runTestsByPath src/waitlist/waitlist.service.spec.ts src/waitlist/waitlist.controller.spec.ts src/email/restock-email.spec.ts
npx playwright test --config playwright.waitlist.config.cjs
```

Los navegadores utilizan servidor estático local y API interceptada; toda petición externa se bloquea. Son emulaciones de anchura, no teléfonos físicos. Se prueban acceso real por el modal existente, confirmación explícita, tallas agotadas, persistencia, cancelación, error/red lenta, Quick Add, preselección, panel móvil/escritorio y filtros. La aceptación SMTP de los tests es simulada, no entrega real.

La prueba de integración crea un **PostgreSQL real temporal en 127.0.0.1**, con puerto/credencial aleatorios, sin usar `DATABASE_URL` de la aplicación. Aplica un esquema de prueba y la nueva migración sólo allí; usa servicios reales, conexiones concurrentes y un correo falso. No es un script de despliegue. En Windows, para repetirla sin añadir dependencias al proyecto:

```powershell
$waitlistTools = Join-Path ([System.IO.Path]::GetTempPath()) ('cronox-waitlist-tools-' + [guid]::NewGuid().ToString('N'))
npm install --prefix $waitlistTools --no-audit --no-fund embedded-postgres@18.4.0-beta.17
$env:WAITLIST_TEST_PG_MODULE = Join-Path $waitlistTools 'node_modules/embedded-postgres/dist/index.js'
node --test cronox-backend/test/waitlist.integration.cjs
```

Antes, ejecutar el build del backend y generar Prisma. El test detiene PostgreSQL y conserva únicamente su directorio temporal para inspección; no lo publicar. No se conecta a un PostgreSQL ya existente ni ejecuta seeds/limpiezas. Los binarios de prueba son PostgreSQL 18; no se ha comprobado la versión o el rol SQL reales de producción.

## Publicación: orden obligatorio (no ejecutado)

### Resultados de la implementación inicial local

- Jest: **15 suites, 181 pruebas**, todas correctas. Incluye Waitlist, correo, permisos/CSRF, inventario, variantes, pedidos, carrito, lanzamiento, galería e imágenes responsivas.
- PostgreSQL 18 temporal: **17 escenarios** más el contenedor de prueba (18 resultados del runner), todos correctos. Migración real, transacciones, rollback, guardado múltiple de inventario, ajustes, solicitudes concurrentes, dos trabajadores/conexiones y `SKIP LOCKED` con una fila bloqueada. SMTP sustituido por un objeto falso.
- Waitlist Playwright: **30 pruebas** correctas en Chromium, Firefox y WebKit. PDP a 320/390/768/1366 px; administración a 375/1366 px. Incluye navegación real del panel, imagen principal optimizada y registro/login mediante el modal existente. Capturas revisadas; sin errores JavaScript no controlados en esos flujos.
- Regresión del carrito: **29 pruebas** correctas en Chromium, incluidas anchuras de 320 a 1920 px, paisaje y equivalencias de diseño para zoom. Esta pasada de la suite completa del carrito no se repitió en Firefox/WebKit.
- Generación de Prisma, `prisma validate`, build Nest, build Vite, comprobación del backend compilado `smoke:exports:compiled` y `git diff --check`: correctos.
- Ningún teléfono físico, SMTP real, inbox real, servidor desplegado o PostgreSQL de producción se ha utilizado para estas pruebas. No se enviaron correos reales ni se cambió ningún dato de producción.

Verificación posterior del **arranque habilitado por defecto**: 4 suites/57 pruebas correctas (Waitlist, permisos, correo y lanzamiento), 17 escenarios PostgreSQL aislados correctos sin definir la variable, build del backend y comprobación de arranque compilado correctos. Las pruebas de ciclo de vida invocan `onModuleInit` en modo producción con reloj y remitente falsos: un aviso elegible se procesa en el primer ciclo de diez segundos, tanto sin variable como con `true`. Comprueban también `false`, valores inválidos, correo no configurado, tienda cerrada y la desactivación del modo smoke. No se ha arrancado el trabajador en producción.

### Pasos pendientes

**Para instalar la función completa: migración sí, cliente Prisma sí, build sí y reinicio del backend sí.** El cambio posterior del valor por defecto no añade otra migración. El trabajador ya no requiere una variable de activación si no existe una anulación explícita; el correo sí requiere su configuración habitual.

1. Revisar y aprobar los cambios. Para el primer despliegue con envío automático, comprobar que **ninguna** instancia hereda `WAITLIST_EMAIL_WORKER_ENABLED=false`: dejarla ausente o establecer `true`. Confirmar `EMAIL_ENABLED=true`, SMTP INFO y `FRONTEND_URL`. No cambiar `EMAIL_ENABLED` global sólo para probar Waitlist: afectaría a otros correos. Para pruebas sin envío, usar un entorno aislado o el interruptor explícito `false`.
2. Preparar la versión en el checkout de despliegue. Desde su raíz:

   ```sh
   npm ci
   npm ci --prefix cronox-backend
   npm run prisma:generate --prefix cronox-backend
   npm run admin:build
   npm run build:compiled --prefix cronox-backend
   ```

3. Con copia de seguridad y la conexión de servidor confirmada por el responsable, comprobar/aplicar las migraciones **antes de arrancar el nuevo backend**:

   ```sh
   cd cronox-backend
   npx prisma migrate status
   npm run prisma:migrate:deploy
   ```

   Este comando aplica **todas** las migraciones pendientes, no sólo Waitlist. Revisar especialmente las migraciones recientes del lanzamiento. No usar `db push`, `migrate reset`, `seed` ni scripts de limpieza en producción. `db push` sólo se usa dentro de la base efímera del test.

4. Reiniciar/recargar el servicio real del backend con la versión compilada, después publicar los archivos frontend de la misma versión. El comando de reinicio depende del gestor real del servidor; no está confirmado en el repositorio. No abrir un segundo `npm start` en paralelo al servicio.
5. Tras el reinicio, el trabajador arranca automáticamente si no hay una anulación `false`. Los envíos quedan pausados hasta que el correo esté configurado y la tienda esté abierta. No hace falta cron externo ni un proceso diferente. Una o varias instancias están soportadas; las que no deban enviar mantienen el indicador en `false`.

El workflow `.github/workflows/deploy.yml` comprueba dependencias, genera Prisma y compila en CI. Después ejecuta `/var/www/cronox/deploy.sh`, **externo a este repositorio**. No se puede asegurar que ese script migre, genere, publique y reinicie en ese orden. Revisarlo antes de hacer push a main (ese push inicia el despliegue). No añadir el test PostgreSQL temporal a dicho script. No se ha hecho commit, push ni despliegue de esta función.

## Comprobación después de publicar sin enviar correos

Esta es una comprobación opcional sin correo, **no el modo de despliegue predeterminado**. Si se realiza en producción requiere decidir expresamente una pausa: `WAITLIST_EMAIL_WORKER_ENABLED=false` en todas las instancias y reinicio. Es preferible staging con SMTP falso. Con los envíos pausados, usar una cuenta de prueba **ya existente**, iniciar sesión y pedir un aviso de una talla realmente agotada sin editar stock. Recargar y comprobar que sigue activo; comprobar su contador en Waitlist, cancelarlo y verificar que deja de contar como demanda. No crear una cuenta nueva sólo para esta prueba si sus correos de alta están habilitados. No habilitar el trabajador mientras queden solicitudes de prueba activas.

Las reposiciones, entregas y errores deben probarse en staging aislado con SMTP capturado/falso antes de activar envíos reales. No hacer compras, devoluciones o ajustes de stock de producción para probar esta función. Probar con el trabajador apagado verifica la interfaz y persistencia, **no la entrega SMTP**.

## Comprobar una anulación en producción/PM2 (sin mostrar secretos)

En esta revisión sólo se ha podido inspeccionar el checkout local: el `.env` local y el entorno del proceso no definen la variable; el workflow tampoco la fija. No hay archivo ecosystem/PM2 versionado ni acceso SSH configurado en este entorno. El `.env` real, la configuración PM2 y `/var/www/cronox/deploy.sh` siguen sin poder comprobarse: **no se afirma que producción esté activada**.

En una terminal del servidor, con el mismo usuario que administra PM2, este comando imprime sólo nombre, directorio de trabajo y el ajuste de Waitlist, nunca el resto de variables:

```sh
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{for(const p of JSON.parse(s)){const e=p.pm2_env||{};console.log(JSON.stringify({name:p.name,cwd:e.pm_cwd,WAITLIST_EMAIL_WORKER_ENABLED:e.WAITLIST_EMAIL_WORKER_ENABLED??e.env?.WAITLIST_EMAIL_WORKER_ENABLED??"NO DEFINIDA EN PM2"}))}})'
```

En el directorio `cwd` del backend que muestre ese comando, comprobar **sólo** la línea correspondiente del `.env`:

```sh
grep -nE '^[[:space:]]*WAITLIST_EMAIL_WORKER_ENABLED[[:space:]]*=' .env
```

Que PM2 no muestre la variable no descarta que el `.env` la defina. Revisar además ese ajuste concreto en `env`/`env_production` del ecosystem, en el script externo de despliegue y en el entorno que lanza PM2. No compartir `pm2 env`, `pm2 jlist` sin filtrar ni el `.env` completo.

Si alguno fija `false`, cambiar **la fuente persistente** a `true` (o eliminar la anulación). Si PM2 conserva una copia antigua, actualizarla en el siguiente reinicio autorizado, sustituyendo `NOMBRE_REAL_DEL_BACKEND` por el nombre mostrado arriba:

```sh
WAITLIST_EMAIL_WORKER_ENABLED=true pm2 restart NOMBRE_REAL_DEL_BACKEND --update-env
```

Si el despliegue usa un ecosystem, corregir también sus bloques de entorno antes de su siguiente ejecución; de lo contrario podría volver a imponer `false`. Conservar la configuración mediante el procedimiento habitual de PM2 del servidor, si utiliza procesos guardados. Después repetir la consulta filtrada y comprobar Waitlist. No se ha ejecutado ninguno de estos cambios en el servidor.
