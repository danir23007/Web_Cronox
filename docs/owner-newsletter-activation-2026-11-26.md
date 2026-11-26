# Activación administrativa de las cuentas existentes

Operación expresa solicitada por el propietario el 26/11/2026. Es una actualización administrativa de elegibilidad comercial, **no una aceptación del usuario**. No cambia los formularios ni crea una regla de reactivación.

## Alcance leído antes de modificar

La auditoría inicial de solo lectura volvió a encontrar 100 cuentas ACTIVE, 24 suscritas y 76 false, sin supresiones, emails inválidos o duplicados. Todos los roles forman parte del alcance: 67 USER, 30 FRIEND, dos ADMIN y un SUPERADMIN. Se comprobaron además todas las campañas SCHEDULED/PROCESSING, no solo Black Friday: cero.

El archivo privado de esa primera auditoría fija la cohorte; la preparación añade identityUid, fecha de creación y hash de email para detectar sustituciones/cambios de identidad. Se conserva el valor inicial de newsletterSubscribed. Las 24 inicialmente suscritas no se escriben. Las cuentas creadas después no se incorporan.

El identificador único de esta petición es `owner-nl-20261126-existing-accounts`. El plan preparado para las 100 cuentas tiene hash `1badc4db6435688fec409d12a719c648668874d46789c0427746832fdf4b7af4`. La preparación es de solo lectura y encontró 76 valores iniciales false y cero campañas en curso/programadas.

## Aplicación segura y procedencia

`owner-newsletter-activation.ts` reutiliza Prisma, normalizeEmail, preferenceKey y los bloqueos por dirección de las preferencias existentes. No se llama a saveNewsletterPreference para activar: ese recorrido representa una elección del usuario y asignaría subscribedAt, lo que sería incorrecto para esta operación.

La aplicación usa una sola transacción Serializable, un bloqueo del lote, bloqueos de preferencias y filas, y un respaldo privado sincronizado a disco **antes de la primera escritura**. Revalida identidad, supresiones y registros de rechazo expreso. Un false antiguo o la ausencia de registros de aceptación no bloquean la activación administrativa. Una baja/rechazo expreso sí; cualquier otra supresión se conserva y se informa por motivo. No se alteran roles, círculos ni estados de cuenta.

Se vincula NewsletterSubscription a la cuenta existente, sin modificar subscribedAt, verificación, beneficios o historia de entrega. Cuando falta la relación, se crea con subscribedAt y verifiedAt nulos. No se generan cupones, bienvenidas, accesos, entregas ni trabajos de correo.

Por cada cambio, AuditLog conserva los valores anteriores del flag, fecha de actualización y registro de suscripción, los valores posteriores y la fecha real de la operación. El motivo es **«activación administrativa solicitada por el propietario»**, con `administrative=true` y `userConsent=false`, bajo NEWSLETTER_ADMIN_ACTIVATION. No se escribe una aceptación en NEWSLETTER_PREFERENCE.

El marcador duradero del lote establece la idempotencia: repetirlo devuelve cero actualizaciones antes de consultar o modificar preferencias actuales. Una baja posterior sigue funcionando con los mecanismos existentes y repetir el lote no la revierte. Cambiar la cohorte manteniendo el identificador del lote se rechaza.

La tabla MailboxCampaign queda protegida durante la comprobación y el commit para que no aparezca una programación entre ambos. Si hay una campaña programada o procesándose, se aborta antes de cambiar cuentas y se requiere revisar la consecuencia con el propietario. No se modifica ninguna programación.

## Comandos explícitos

Desde cronox-backend, después de compilar. Los directorios están fuera del frontend servido y nunca se incluyen en Git:

```powershell
node scripts/audit-campaign-audience.cjs --production --backup-dir=../output/owner-newsletter-activation/start
node scripts/activate-owner-newsletter.cjs --production --prepare --initial-audit=../output/owner-newsletter-activation/start/audit.private.json --workdir=../output/owner-newsletter-activation/operation
node scripts/activate-owner-newsletter.cjs --production --apply --workdir=../output/owner-newsletter-activation/operation
# Repetir el mismo --apply debe devolver alreadyApplied=true y updated=0.
```

Los archivos privados se crean exclusivamente, con modo restrictivo y fsync para el respaldo. La consola solo publica cantidades/motivos y hashes; no direcciones. No se inicia Nest, SMTP ni trabajadores. Ninguno de estos comandos está conectado a arranque, migraciones o despliegue.

Existe compensación explícita `--rollback` con el mismo workdir. Solo restaura filas sin modificaciones posteriores; un rechazo/baja o cambio posterior bloquea toda la reversión. Se conserva AuditLog y todo histórico previo; solo podría retirar relaciones nuevas, sin historia adicional, creadas por esta operación. No se ejecuta una reversión en producción como prueba.

## Comprobaciones

La prueba `node scripts/test-owner-newsletter-activation-db.cjs` usa PostgreSQL real de loopback y una base desechable eliminada al terminar. Verifica roles, cohorte congelada, rechazo expreso, procedencia administrativa, relaciones sin fechas de aceptación inventadas, idempotencia tras una baja posterior, compensación, rollback completo tras un fallo tardío y bloqueo por programación. Se acreditan cero MailboxSend, entregas y trabajos de newsletter creados. Las pruebas unitarias verifican la capacidad fija, hashes y guardias antes de escribir.

Resultado local: **347 suites y 3.730 pruebas aprobadas**, tipos y compilación de backend correctos, y seis comprobaciones transaccionales de PostgreSQL aprobadas. No hay cambios de interfaz ni migraciones. Las pruebas de base de datos y las consultas operativas no realizan envíos.

Después del despliegue habitual se ejecuta la aplicación explícita en producción y otra auditoría de solo lectura. Se contrastan las huellas del borrador/plantillas de Black Friday, el estado DRAFT y la ausencia de programación. El plan completo renderizado, el Excel y la selección efectiva se comparan en memoria, con transporte prohibido y sin crear envíos. Los resultados operativos se guardan en los resúmenes privados del lote. La web se publica mediante Deploy CRONOX; esto no publica plantillas ni envía la campaña.
