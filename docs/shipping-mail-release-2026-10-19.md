# Correos, marcado manual por lotes y correos de cuenta — 19/10/2026

Este documento registra la reconciliación y validación previa a publicación. El titular ha autorizado expresamente correcciones, commits, push, migraciones y despliegue por el procedimiento existente; sustituye el límite local anterior. El resultado de la publicación debe verificarse en el workflow **Deploy CRONOX**, en el diario del controlador del SHA solicitado y mediante comprobaciones posteriores independientes; lanzar el workflow no equivale a éxito.

## Estado conciliado antes de publicar

- Local y `origin/main`: `166f7e2`; el código de Correos publicado previamente está en `036d1c2`. Se conservaron todos los cambios locales de contraseña y coordinación logística de la tarea anterior.
- SSH de solo lectura: producción sirve `036d1c2f9d06773ddf5858462d59b209a76b3094`, PM2 deploy online, health 200. La migración `20261018180000_correos_fulfillment` está terminada; falta exclusivamente `20261018220000_mail_event_coordination` de este trabajo.
- Los cambios locales del VPS están en dependencias instaladas y una copia auxiliar no versionada `cronox-backend/src/main.ts.cronox-before-stripe`. No se descartan ni incluyen en el commit. La publicación debe comprobar ausencia de solapamiento mediante el controlador existente.
- Pages sigue en modo workflow. Push verifica y solo `workflow_dispatch / publish=true` solicita publicación al controlador instalado. No se usa despliegue alternativo por SSH ni se modifica el controlador privilegiado.
- Producción: cero pedidos con seguimiento, cero eventos, outbox logístico vacío, ningún efecto de checkout pendiente y ninguna entrega SMTP pendiente/incierta en la auditoría. No hay un par legítimo pedido/código accesible para probar Trackpub.

## Correcciones completadas

El detalle de escenarios, códigos, deduplicación, primera sincronización, corte histórico y plantillas está en [coordinación de correo y logística](mail-logistics-coordination-2026-10-18.md). La migración aditiva revisada conserva históricos; no se editan migraciones aplicadas.

Los escenarios `NEW_ACCOUNT`, `EXISTING_PASSWORDLESS` y `NOT_NEEDED` se persisten al procesar el pago confirmado. Los dos primeros producen, respectivamente, los asuntos exactos «CRONOX · Tu cuenta está lista: configura tu contraseña» y «CRONOX · Configura tu contraseña y consulta tu pedido». El segundo nunca afirma creación de cuenta. Recuperación de webhooks reutiliza el escenario, con enlace de un uso y una hora, sin establecer contraseñas al comprar. La recuperación explícita sigue disponible tras caducar; las cuentas con contraseña no reciben configuración. Se mantienen bienvenida, descuento y confirmación.

Los diseños antiguos se conservan y se adaptan de forma compatible para las nuevas finalidades, incluido texto plano. Las carpetas por círculo siguen existiendo como organización del editor: **no se implementa ni se declara selección automática de publicación por círculo del destinatario**.

### Flags por origen

Se corrigió el bloqueo común que hubiera retenido también las confirmaciones manuales:

| Origen del trabajo | Condición de despacho |
| --- | --- |
| `MANUAL` | Correo transaccional habilitado, jobs no desactivados y smoke apagado; independiente de ambos flags Correos |
| `CORREOS` | Lo anterior y `ORDER_LOGISTICS_EMAIL_ENABLED=true`, o respaldo `CORREOS_EMAIL_ENABLED=true` cuando el nuevo flag no existe |

Un `false` explícito nuevo mantiene apagados los avisos automáticos. El mismo worker consulta trabajos manuales aunque Trackpub esté apagado, filtra por origen antes de reclamarlos y vuelve a comprobar antes de SMTP. Los trabajos automáticos deshabilitados permanecen sin reclamar: no bloquean los manuales ni consumen sus intentos. Se conserva revisión `UNKNOWN` tras una entrega incierta y la cuota/reintento seguro; no hay un segundo worker ni cola SMTP competidora para estos hitos.

El estado, evento manual, auditoría y trabajo se confirman en una misma transacción. El correo llega después por ORDERS (`orders@cronox.es`); su fallo no deshace Enviado. Admisión y manual, en cualquier orden o concurrentes, comparten la clave de enviado por pedido. Entrega usa la misma coordinación; reparto/incidencia/devolución se notifican específicamente. No se envía además un genérico. Etiqueta/prerregistro/asociación no prueban admisión ni generan enviado. Transporte no modifica pagos, stock o reembolsos.

### Marcado manual por lotes

Administración incorpora **Previsualizar marcado como Enviados** y una confirmación explícita con el número válido. La selección es exclusivamente la página visible; paginar, recargar o cambiar selección invalida la vista previa. No se amplía implícitamente a todos los pedidos.

`POST /api/admin/orders/fulfillment-bulk/mark-shipped` exige sesión SUPERADMIN/identidad y la protección de escritura existente. Acepta un máximo de 100 filas y `preview` obligatorio. Cada fila se valida en servidor; no modifica pedidos presenciales, recogidas, pendientes de pago, disputados, cancelados, reembolsados o entregados. Los resultados distinguen válido, actualizado, ya enviado, omitido y error concreto. IDs duplicados/ausentes/incorrectos se informan por fila.

La ejecución requiere estado y revisión de la vista previa y los comprueba bajo el bloqueo del pedido. Procesa secuencialmente, con concurrencia acotada. Una carrera que ya haya marcado Enviado se informa como ya enviado; repetir o hacer doble clic no duplica eventos/avisos. Los resultados parciales permanecen visibles y el resumen cuenta omitidos/errores, sin presentarlos como éxito total. No se inventan ni sobrescriben códigos o etiquetas. Se conserva asociación individual/importación por pares/sincronización por lotes y las protecciones de sustitución.

## Resolución exacta de EPERM e instancia local

La enumeración de módulos de procesos Windows identificó un único propietario de `cronox-backend/node_modules/.prisma/client/query_engine-windows.dll.node`: PID **20768**, `node output/playwright/prepublish-20261017/local-server.cjs`, con listener **127.0.0.1:3000**. Era el servidor de revisión de este repositorio, con base `127.0.0.1:5433/cronox_dev`, correo/jobs desactivados y guardia de red local. No se detuvieron Adobe, navegadores, otros procesos Node ni otros proyectos.

Se detuvo únicamente ese PID y `npm run prisma:generate --prefix cronox-backend` completó la sustitución real de la DLL y la generación de Prisma Client **6.19.3**. También pasó de nuevo el `prebuild` real de `npm run build`. `prisma migrate diff` entre el modelo fuente y el esquema generado confirma **cero diferencias**; el cliente expone 110 modelos y los campos nuevos. El mismo servidor quedó restaurado con el compilado final (PID 56976, health y ready 200), base local, correo/jobs false y sin credenciales SMTP/Supabase. Al regenerar en el futuro, Windows vuelve a requerir que el proceso que carga esa DLL esté temporalmente detenido.

## Verificación previa y límites

- **2.874 pruebas / 268 suites** completas de backend, checkout, auth, SMTP, catálogo, frontend DOM y logística.
- **37 comprobaciones PostgreSQL reales**, base temporal eliminada: dos migraciones reales, schema diff cero, RLS/índices, escenarios persistidos, concurrencia de compra, token hash/caducidad/uso único/recuperación, manual/Correos en ambos órdenes, lotes/concurrencia/repetición/revisión obsoleta, exclusiones, stock intacto y despacho manual con ambos flags Correos apagados. Correos y SMTP simulados.
- Typecheck backend y admin, generación Prisma real, compilación Nest normal con prebuild y build admin.
- **16 pruebas** de guardias de publicación Node. Las pruebas Python del controlador usan primitivas Linux; la ejecución Windows tiene fallos de plataforma y no se presenta como validación Linux. El CI Ubuntu debe ejecutar y aprobar la suite completa antes del despliegue.
- Chromium: vista previa, confirmación y fallo parcial del lote a 1440×1100 y 390×844; estados separados, filtros e historial del perfil; los dos mensajes de contraseña y cinco logísticos. Se usan páginas/JS/plantillas reales con respuestas ficticias. Las capturas y los informes privados están ignorados en `output/playwright` y `test-results`.
- Matriz oficial de Correos descargada de nuevo el 19/10: coincide con las filas revisadas, SHA-256 `1006b40afd62e0465d0f4c2470b73770e85c773093f6dfac26d25ac724b2c974`. Sin inferencias por palabras ni prefijos.

Comandos reproducibles:

```powershell
npm run prisma:generate --prefix cronox-backend
npm run typecheck --prefix cronox-backend
npm run admin:typecheck
npm test --prefix cronox-backend -- --runInBand --silent
node cronox-backend/scripts/test-correos-tracking-db.cjs
npm run build --prefix cronox-backend
npm run admin:build
node .github/scripts/check-checkout-release-safety.cjs
```

## Configuración que se conserva y dependencia externa

La lectura efectiva previa al despliegue encontró `CORREOS_TRACKING_ENABLED=false`, `CORREOS_EMAIL_ENABLED=false`, nuevo override ausente; `EMAIL_ENABLED=true`, `BACKGROUND_JOBS_ENABLED=true` y recuperación Stripe habilitada. SMTP ORDERS y las cuatro credenciales Correos están configurados, sin mostrarlas ni rotarlas. No se modifican `.env` ni preferencias productivas ajenas a este cambio.

No se activa Trackpub ni sus avisos automáticos sin la etiqueta/par legítimo confirmado y autorización/cuota verificadas. La presencia de credenciales o un token de Identidad no valida seguimiento. La falta de ese envío no impide publicar ni operar el marcado manual individual/masivo, los correos de contraseña y la confirmación de compra.

El intervalo efectivo de Correos no está configurado explícitamente: valor por defecto **1.800 segundos (30 minutos) por pedido**, con despertar del worker cada 10 segundos y compuerta/cuota compartida. No es detección instantánea. Los terminales se revisan como máximo diariamente durante siete días por defecto; los errores usan espera progresiva. Los avisos manuales se atienden por el mismo despertar de 10 segundos, sujetos a cola, SMTP y cuota.

## Criterios de publicación

Revisar diff/archivos y commit exacto; push sin fuerza; verificar CI y ausencia de cambios en main; solicitar **Deploy CRONOX** con `publish=true`. El controlador existente debe completar mantenimiento, parada de escritores, respaldo, **restauración real y comparación aislada**, instalación, exclusivamente la migración pendiente, arranque pausado, recuperación habitual de jobs y reapertura. No se omiten guardias, no se ejecuta `migrate resolve`, ni se restauran datos sobre producción como prueba.

Después deben coincidir SHA solicitado, HEAD remoto, recursos servidos y migraciones; health/ready públicos, PM2/worker/flags, cachés y ausencia de avisos históricos imprevistos deben comprobarse independientemente. Administración/perfil se revisan con sesiones legítimas disponibles, sin cambiar pedidos ni enviar comunicaciones a clientes para demostrar funcionamiento. Los límites de autenticación o proveedor se informan expresamente.
