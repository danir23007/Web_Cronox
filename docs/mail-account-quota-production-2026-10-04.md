# CRONOX: cuotas compartidas y continuación de producción

## Recuperación y PM2 verificados

El operador ejecutó el procedimiento corregido sobre `/root/cronox-backups/mail-Glyc9k`. Informe leído por SSH a las 21:00 Europe/Madrid: hashes válidos, esquema de aplicación restaurado, 17 archivos privados referenciados descifrados, credenciales de cuatro buzones recuperadas y 73 migraciones presentes. PostgreSQL aislado usó socket Unix privado, sin TCP ni trabajadores, y quedó detenido en `/var/tmp/cronox-mail-restore-qUw912`. No se restauraron los esquemas gestionados de Supabase sobre ese PostgreSQL genérico; el dump completo sí los contiene.

La causa de los dos fallos anteriores era que `pg_restore --schema=public` excluía la dependencia de extensión `pg_trgm`. La corrección restaura pre-data, crea la extensión y restaura data/post-data, incluyendo índices y restricciones. Se probó primero con una base sintética y un índice GIN, y después con el backup real.

PM2 conservó PID 265983, 928 reinicios acumulados, cero inestables y salida 0 durante ambas lecturas separadas por 60 segundos. Inicio 17:29:33 UTC del 4/10; última modificación del log de errores 1/10. No hay evidencia de un bucle actual. El posterior reinicio de preparación fue para cargar flags autorizados, no por el contador histórico.

## Contador compartido

`MailAccountQuota` reserva destinatarios distintos de Para/CC/CCO en una transacción junto al inicio del intento. Automáticos, manuales y campañas bloquean la misma identidad SMTP autenticada normalizada mediante `pg_advisory_xact_lock`. Alias de la misma cuenta comparten el límite menor. Cada cuenta tiene 1000 unidades por 24 horas móviles; la cuota horaria es opcional y 0 la desactiva. No hay reinicio a medianoche ni capacidad reservada entre buzones.

Las reservas mínimas no dependen de cuerpos, borradores ni copias del proveedor y no se borran con la retención. Rechazos e incertidumbres no liberan capacidad. Los reintentos seguros de campañas consumen una reserva adicional. La migración aditiva `20261004190000_mail_account_quota` conserva las unidades históricas y no cambia estados ni reencola UNKNOWN. RLS impide acceso público al contador.

Newsletter y reposición mantienen sus colas y esperan hasta la expiración de capacidad sin agotar reintentos SMTP. Manuales y campañas conservan sus estados pendientes. Pedidos confirmados/enviados/entregados pueden esperar en un outbox cifrado, evitando perder el aviso tras una transición de negocio ya confirmada. `queued:true` no acredita aceptación SMTP. La recuperación de intentos interrumpidos requiere revisión y nunca reenvía automáticamente un resultado incierto. Las acciones inmediatas de autenticación no guardan enlaces que podrían caducar durante una espera: informan del agotamiento de cuota.

Se comprueba un máximo de 100 destinatarios, 35000000 bytes del MIME completo y 25000000 bytes de adjuntos sumados. El contador local no conoce envíos de webmail ni impone los 10 GB/100000 mensajes del proveedor.

## Verificación y secuencia operativa

- Compilación Prisma/Nest y 253 pruebas en 25 suites de correo, campañas, newsletter, reposición y frontend relacionado.
- 67 comprobaciones integradas con PostgreSQL efímero, IMAP simulado y SMTP/TLS loopback: migración sobre fixtures históricos, concurrencia entre flujos, independencia de cuentas, expiración móvil, idempotencia, espera cifrada y aceptación única, privacidad/RLS y retención selectiva. No se enviaron correos reales.
- El operador completó `configure-production-mail.cjs prepare`; informe efectivo leído: PID 268977, límites explícitos, seguimiento habilitado, trabajadores/envíos/campañas pausados y retención deshabilitada. Pagos/pedidos y otros trabajos del backend no se desactivaron.

El ayudante requiere root porque deploy no puede actualizar el entorno efectivo de PM2. Guarda la configuración original en el backup privado y confirma los valores cargados tras `restart --update-env`/`save`; no expone secretos. Modos separados: `prepare`, `dryrun`, `clean`, `activate`. Comprueba el backup verificado y sus hashes antes de operar. No arranca Nest ni manda pruebas SMTP.

La publicación sigue el workflow existente de main, que aplica únicamente migraciones pendientes con `prisma migrate deploy`. Después se ejecuta `dryrun` con leases reales y correo pausado. `clean` vuelve a comparar el plan antes de borrar: cambios, lotes adicionales o resultado previo impiden repetirlo sin revisión. Conserva copias INFO no asociables y usa el servicio existente con UIDPLUS. `activate` exige migración terminada, limpieza completa y ausencia de campañas anteriores activas antes de reactivar correo, seguimiento y retención periódica.

La UI publicada autenticada sigue pendiente de una pestaña conectada del usuario. El menú y la estabilidad visual conservan íntegramente `5400f31`; sus pruebas de navegador locales previas constan en el informe de publicación. No se usa una cuenta o contraseña nueva para acceder.

## Resultado definitivo: 21:31 Europe/Madrid

- Código publicado y desplegado: `18a54655e9e87f8a4a386fa5a7992affd316010a`, incluyendo todo el trabajo anterior y el commit de operaciones `ef41a3c`. [Deploy CRONOX 37227773815](https://github.com/danir23007/Web_Cronox/actions/runs/37227773815) terminó correctamente. La comprobación de main, los artefactos y el estado del VPS corresponden a esa versión.
- 74 migraciones aplicadas, ninguna pendiente ni incompleta. La nueva cuota compartida terminó a las 19:20:57 UTC. Se conservaron seis reservas automáticas y cinco manuales históricas, con RLS activo y sin permiso de lectura para anon/authenticated. Las reservas actuales de las últimas 24 horas son cero en las cuatro cuentas; esto no informa del consumo externo en webmail.
- El operador completó la simulación coordinada, la limpieza y la activación usando el ayudante revisado. El plan tenía corte 19:24:03 UTC y se volvió a comparar antes de borrar. Orders: 2 copias locales y 2 remotas retiradas; No-reply: 1 local y 1 remota. Info: 0/0, conserva su mensaje no asociable; Support: 0/0, conserva dos mensajes recientes. Borradores afectados: cero. No se afirma haber desactivado el guardado automático de Hostinger; la política utiliza limpieza selectiva con UIDPLUS, nunca EXPUNGE general.
- El entorno efectivo confirma `MAILBOX_WORKER_ENABLED`, `MAILBOX_SEND_ENABLED`, `MAILBOX_CAMPAIGN_ENABLED`, `NEWSLETTER_EMAIL_WORKER_ENABLED` y `WAITLIST_EMAIL_WORKER_ENABLED` en true. `EMAIL_SMTP_PAUSED=false`. Seguimiento y retención periódica en true; Support mantiene el corte fijo de 30 días. Cuatro límites diarios de 1000 y horarios de 0; campañas de Info 1000/24h con intervalo de 30 segundos. Máximos efectivos: 100 destinatarios, MIME 35000000 bytes y adjuntos totales 25000000 bytes.
- PM2 online con PID 270374, inicio 19:28:49 UTC, 931 reinicios acumulados, cero inestables, salida 0 y log de errores sin nuevas modificaciones. Los tres reinicios añadidos corresponden a preparación, despliegue y activación. El mismo PID sigue activo más de dos minutos después; no se reinició el sistema operativo.
- Salud pública y local correcta. Se leyeron IMAP/TLS y UID/banderas usando EXAMINE: Info conserva 2 recibidos, No-reply 1, Orders 4 y Support 3, iguales al panel, sin UID faltantes/sobrantes ni cambios de UIDVALIDITY. Enviados: Info 1, Support 2, Orders/No-reply 0, tanto en proveedor como en caché. Las cuatro sincronizaciones avanzaron después de la activación, con estado CONNECTED y sin errores. No se observó una llegada natural nueva y no se envió un correo para provocarla.
- Colas conservadas: 5 manuales SMTP_ACCEPTED, 0 campañas, 2 newsletter SENT y 1 reposición WAITING. Auditoría automática: los mismos 5 Info y 1 No-reply aceptados. No hubo nuevos envíos de prueba, campañas ni reencolado de incertidumbres.
- Los cinco recursos públicos de menú/correo/galería/seguimiento coinciden con el código local. El GET de seguimiento con token inválido devuelve 400 sin registrar visitas. La UI autenticada, perfil y contraseñas siguen pendientes de una pestaña conectada; no se cambió ninguna contraseña. Las pruebas locales previas del administrador en escritorio/móvil y claro/oscuro se conservaron.

Esta actualización de resultados queda en un commit local de documentación; no dispara otro despliegue. El código operativo de producción sigue siendo `18a5465`.
