# Publicaciones autónomas de CRONOX

Estado a 18/10/2026: **controlador instalado y acceso operativo; transición a deploy terminada y ciclos normales del worker acreditados**. Se completó la instalación autorizada sin publicar cambios funcionales ni aplicar migraciones. La aplicación conserva `488a5185122826188986fd6cedd3e1046cfe42ba`.

## Resultado comprobado en el VPS

- Bootstrap v5: unidad cronox-bootstrap-20261018-v5.service active/exited, Result=success, ExecMainStatus=0. El recorrido exige restauración sintética completa y comparación antes de comenzar la transición. Se completó ese ensayo aislado; no fue una restauración sobre producción.
- pm2-deploy.service activo/habilitado, User=deploy y NoNewPrivileges=yes; pm2-root.service inactivo/deshabilitado. Aplicación cronox PID 275405, UID 1000, arranque 2026-10-18T00:48:49.543Z. HOST=127.0.0.1 y worker habilitado, también guardados en dump.pm2.
- Backend únicamente en loopback, mantenimiento inactivo. Portada de cronox.es, health y ready externos responden 200; los dos endpoints también responden 200 en www.cronox.es. La portada www redirige con 308 a cronox.es y termina en 200. El checkout funcional sigue en 488a518.
- El directorio del controlador quedó inicialmente en 700 por umask 077. El administrador comprobó sus componentes contra el manifest v5 y corrigió el directorio a 755. SSH confirmó que deploy puede leer preflight.cjs/build.sh/controller.py sin poder modificarlos; siguen siendo de root. El instalador fuente ya aplica chmod explícito.
- Sudo concede exclusivamente request/status/recover. Se verificaron el rechazo de SHA inválido, la denegación del verbo interno worker y el rechazo de status para una publicación inexistente sin crearla. No se solicitó una publicación válida como prueba.
- Pages está en modo workflow, comprobado mediante API. Se conserva el workflow existente: push verifica código; sólo workflow_dispatch publica. No se añadió otro canal de despliegue.

Worker actual: **ciclos normales acreditados mediante sesión SUPERADMIN legítima del operador**, quien aportó la salida del comprobador privado el 18/10/2026. Ambas lecturas de GET /api/admin/payments/recovery muestran enabled=true, disabledReason=null y startedAt=2026-10-18T00:48:51.309Z. lastScanCompletedAt avanzó de 2026-10-18T01:17:46.589Z a 2026-10-18T01:17:56.729Z; lastScanErrorAt y lastScanError son null en ambas. El comprobador indicó advancing=true y CICLOS_RECUPERACION_VERIFICADOS. No se presenta la autenticación realizada por el operador como una consulta independiente de Codex.

Contraste independiente posterior por SSH: PM2 deploy activo, aplicación online PID 275405, iniciada a las 00:48:49.543Z, mantenimiento inactivo y HEAD funcional 488a518 intacto. El inicio del worker corresponde al arranque de esa instancia después de la transición, no a la instancia anterior al reinicio de red. El comprobador original exigía maintenance.flag y fallaba antes del login; se creó check-recovery-session-online.cjs eliminando únicamente esa precondición y corrigiendo el mensaje, conservando entrada oculta, autenticación y consultas. No se activó mantenimiento, no se reinició el servicio ni se forzaron reprocesamientos. El REVIEW histórico no fue modificado. Esta evidencia acredita escaneos normales, no un pago o recuperación sintéticos.

## Configuración instalada y límites de acceso

Se reutilizan deploy, su clave SSH privada, los secretos CRONOX_VPS_* existentes, Nginx, PM2 y Deploy CRONOX. SSH conserva StrictHostKeyChecking=yes. Los permisos del entorno de Codex no conceden root en el VPS; los controles de herramientas y las restricciones del servidor son distintos.

- /usr/local/lib/cronox-release: root, directorio 755 y archivos 644, sin escritura de deploy. Python usa -I y rutas fijas; no importa módulos desde el repositorio del solicitante.
- /usr/local/sbin/cronox-release: wrapper root 755. Sudo admite únicamente request SHA, status SHA y recover SHA; el parser exige aridad exacta y SHA hexadecimal de 40 caracteres. No concede shell, Docker, systemctl ni sudo general.
- /etc/cronox-release: 700, configuración privada y credenciales 600. Comprueba concordancia entre el perfil de respaldo y DATABASE_URL. Una rotación futura necesita actualizar coordinadamente estos archivos; no se rotaron credenciales durante la instalación.
- /var/lib/cronox-release: 700, diarios y respaldos privados. Status devuelve información saneada, no secretos ni logs completos.
- /var/lib/cronox-pm2: 700, deploy. No se conserva la vía de reiniciar como root código modificable por deploy.
- /etc/sudoers.d/cronox-release: 440. Se retiraron las dos concesiones antiguas preservando el resto de sudoers, con validación visudo y copias privadas.
- cronox-release@SHA.service: ejecución independiente de SSH, exclusión mediante flock, sin reinicio automático. ExecStopPost aplica el estado seguro si falla durante mantenimiento. El guard bloquea escritores tras reinicio con una publicación incompleta.

La consulta de protección de main devolvió 404: no se acredita una protección de rama obligatoria. Revisar SHA y alcance sigue formando parte de cada autorización.

## Instalación y retirada

Paquete instalado: v5, SHA-256 `0d43ba454a04002ac96533f76af4d05cc3a67a3cb6ddf0cea73902353e4785ef`, conservado en /root/cronox-release-bootstrap-v5. No repetir --apply: la instalación terminó. El ajuste posterior de permisos no modificó los componentes.

Los intentos anteriores se detuvieron antes de mantenimiento: v2 no reconocía las concesiones en sudoers principal; v3 aceptaba prematuramente el PostgreSQL temporal de inicialización; v4 dependía de un nombre de proceso incompatible con el wrapper de la imagen. V5 consulta por conexión autenticada el PID del postmaster final, conserva timeout y no reintenta DDL/restauraciones. No se omitieron validaciones.

El instalador capturó HEAD, hashes del dist e historial de migraciones y exigió igualdad antes de parar y antes de reabrir. Evidencia privada: /var/lib/cronox-release/bootstrap/identity-before.json y transition-result.json. El ensayo previo usó datos sintéticos en contenedores sin red, puertos ni montajes del host.

Recuperación de esta transición, sólo ante un fallo revisado compatible: `/usr/bin/python3 -I /root/cronox-release-bootstrap-v5/install.py --recover-transition`. Exige mantenimiento propio, identidad de código/esquema intacta, PM2 root inactivo, permisos antiguos retirados y dump deploy preparado. No restaura datos ni devuelve la aplicación a root. Actualmente no es necesario ejecutarla.

Para retirar la delegación, un administrador ejecuta ese instalador con --revoke, sin publicación activa. Retira sólo la nueva regla sudo validada; conserva aplicación deploy, respaldos y evidencia. No reinstala permisos antiguos. Actualizar componentes privilegiados requiere paquete revisado y aprobación administrativa.

Pages se ajustó mediante configure-pages-dispatch.cjs. Volver a legacy reactivaría publicaciones paralelas y requiere decisión expresa. No se cambió dominio/HTTPS. [API de Pages](https://docs.github.com/en/rest/pages/pages#update-information-about-a-github-pages-site).

## Cómo solicitar una publicación

> «Autorizo publicar el commit `<SHA completo>` de CRONOX mediante el procedimiento autónomo, incluida su ventana de mantenimiento, respaldo verificado, migraciones revisadas y reactivación de los servicios habituales. No autorizo reparaciones históricas ni transacciones o comunicaciones de prueba.»

La autorización cubre el recorrido previsto completo, sin confirmación por comando. No cubre alterar el controlador root, cambiar permisos fuera de lo instalado, rotar credenciales, resolver arbitrariamente migraciones, reparar datos ni cobrar/reembolsar/enviar pruebas reales. Si el cambio requiere alguno de esos actos, se prepara una decisión concreta adicional.

Codex revisa diff y alcance, preserva trabajo ajeno, comprueba CI y que el SHA autorizado siga siendo main. Invoca `Deploy CRONOX` por workflow_dispatch con `publish=true` sobre ese commit/ref. Push solo verifica. Actions pide una vez `sudo -n /usr/local/sbin/cronox-release request SHA` y consulta `status SHA`; no hace un despliegue alternativo por SSH. Antes de futuros pushes también se comprueba que Pages ya no esté en legacy.

## Fases y comportamiento al fallar

| Fase | Operación | Fallo/interrupción |
|---|---|---|
| Preflight | SHA actual de main, fast-forward, cambios locales sin solapamiento, guards existentes, historial/checksums aplicados (acepta equivalencia LF/CRLF histórica), runtime no-root habilitado, salud/loopback, imagen fijada disponible, >=8 GiB libres y DB <512 MiB | Sin mantenimiento ni cambio funcional. Detiene antes de tocar código/runtime. No omite checksum, no modifica migraciones aplicadas. |
| Mantenimiento | Flag propio y comprobación 503 en ambos dominios | Mantiene flag y detiene escritores; no reutiliza mantenimiento ajeno. |
| Parada | PM2 cronox detenido y dump detenido guardado, sin listener, sin otros procesos PM2 ni clientes DB activos/prepared transactions | Mantiene cerrado. No termina sesiones de Supabase ni servicios desconocidos a la fuerza. |
| Respaldo | pg_dump custom + roles sin contraseñas + aplicación (incluye dependencias/configuración; excluye .git/output), archivos root privados | No avanza si falla cualquier copia. |
| Verificación real | Restauración completa en contenedor sin red/puertos/montajes host, mismos objetos, filas/digests, secuencias, permisos normalizados, RLS, políticas y extensiones | No basta listar el dump. Cualquier diferencia bloquea antes de instalar. Conserva logs privados. Solo tolera el tratamiento explícito de roles ya existentes y suplemento GraphQL probado en la ventana anterior. |
| Instalación | Merge fast-forward exacto, npm ci y compilado frontend/backend como deploy; guards existentes antes de migrar | Mantenimiento y parada. No git reset, clean, stash ni descarte de trabajo ajeno. |
| Migraciones | Prisma migrate deploy como deploy, orden del historial, todas terminadas y conjunto de nombres esperado | Mantiene cerrado. No migrate resolve, db push, seed, reparación histórica ni rollback automático. |
| Arranque pausado | Seis controles de jobs/correo/worker false; health/ready, loopback, tienda/cesta/checkout/envío, admin no autenticado 401 y telemetría explícitamente desactivada | Detiene y conserva mantenimiento. |
| Activación | Restituye cinco controles previamente revisados y worker financiero true; dos muestras privadas frescas, mismo PID, avance del escaneo sin error | Puede ejecutar trabajo legítimo pendiente, nunca crea operaciones de prueba. Si no hay avance, detiene y mantiene cerrado. REVIEW no se reencola. |
| Guardado/reapertura | Guarda PM2 y retira solo flag propio, luego HTTP público de ambos dominios | Si falla después de retirar flag, lo repone y para escritores. No declara éxito parcial. |

La política de comunicaciones se conserva en runtime.json. Activar jobs puede enviar comunicaciones operativas legítimas; no se usa email=false para drenar colas reales. El fichero de telemetría es privado 600, no contiene identificadores de eventos/clientes ni payloads, se publica atómicamente y se valida por PID/frescura. No requiere credenciales SUPERADMIN ni desprotege el endpoint existente.

## Pérdida de conexión y recuperación

- Una desconexión de SSH o cancelación/timeout de Actions no mata la unidad de systemd. Consultar **el mismo SHA**, no volver a ejecutar npm, migraciones o restauraciones. `request` es idempotente por SHA: no vuelve a ejecutar un directorio ya registrado. `status` identifica un diario running sin unidad activa como interrupted, no como éxito.
- Publicaciones simultáneas se serializan en GitHub y mediante flock en el VPS. Una publicación no resuelta bloquea nuevas solicitudes. Los comandos request/status no aceptan rutas ni comandos arbitrarios.
- Antes de instalar código/migrar: `sudo -n /usr/local/sbin/cronox-release recover SHA` solicita recuperación separada en systemd. Solo permite fases maintenance/stop/backup, exige mismo HEAD e historial de migraciones que antes; reinicia esa misma versión, no restaura código viejo. Conserva el backup fallido para diagnóstico. No cuenta como publicación exitosa.
- Desde install/migrate en adelante: **no hay vuelta automática al código anterior**. Se conserva mantenimiento, respaldo, esquema actual, SHA y fase. Codex prepara una corrección hacia delante y la revisión concreta que falte. El controlador deliberadamente no ofrece ejecución SQL arbitraria, restauración de producción, migrate resolve ni un botón de ignorar el fallo. Resolver una migración ambigua o rearmar una publicación tras cambios de esquema requiere actuación administrativa revisada; es una limitación explícita, no una autonomía absoluta.
- En reboot durante mantenimiento, el guard impide arrancar automáticamente los escritores. Reactivar un daemon detenido por ese guard requiere revisar la fase y el estado; no saltar el guard. Un contenedor de verificación dejado por SIGKILL puede permanecer aislado; retirarlo por su nombre exacto después de revisar evidencia, sin `docker prune`.
- Los respaldos lógicos y de aplicación no son un backup completo del proveedor: no incluyen objetos externos de Storage, configuración de plataforma, claves raíz de Vault ni servicios externos. No prometen recuperar un desastre total del VPS/Supabase. Mantener PITR/copias externas según la política del titular. La verificación aquí permite afrontar las migraciones de aplicación previstas. [Límites de restauración Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Registros y señales

- GitHub Actions: SHA, resultado verify-release, estados saneados y resultado deploy. Si agota espera, resultado **desconocido**, no restaurado.
- `sudo -n /usr/local/sbin/cronox-release status SHA`: fase, resultado, timestamps, safeStateConfirmed si falló; sin logs privados.
- Root: `/var/lib/cronox-release/SHA/status.json`, private.log, before.json, migrations-before/after.json, backup-verified.json, backup-sha256.json, source/restore-verification.json, worker.json y artefactos privados. Acceso exclusivamente administrativo a contenidos sensibles.
- PM2 de deploy en `/var/lib/cronox-pm2`, bajo pm2-deploy.service. `recovery-status.json` es una señal operativa, no un archivo para publicar. Alertar si no avanza durante 120 s o aparece error de escaneo; investigar REVIEW/FAILED en el panel autorizado sin reencolar automáticamente.
- Control de retención: este primer controlador no borra automáticamente backups. El umbral de espacio bloquea publicaciones antes de quedarse sin disco; la política de retención/copia externa queda pendiente del titular.

## Comprobaciones y pendientes

- 28 pruebas Python/Linux satisfactorias, incluida reproducción real de umask 077. Cubren recorrido simulado, fallos por fase, interrupciones, estado seguro, parser, respuesta SSH perdida, duplicados, recuperación incompatible, telemetría y disponibilidad prematura del servidor temporal. Los adaptadores de producción se simulan; flock y persistencia tras matar procesos se prueban con procesos reales aislados.
- También pasaron comprobaciones focales de Bash/guards, compilación y tests de recuperación/telemetría. No se repitió la batería general para cerrar documentación.
- En el VPS se verificaron restauración sintética previa, transición PM2, identidad funcional, permisos, rechazos del controlador, salud externa y Pages. No se hizo un despliegue funcional de prueba, un reboot real ni una restauración sobre producción.
- Configuración publicada en 0153f4c7248f71e928e94a1c63012ffebcaa4088 y correcciones af175a7, aba178f, 22b97a2 y 97d3bffba983d599c0063ec3c8883cdf1ac0d22a. CI final 39084301376: success, sin despliegue funcional. El cierre modifica sólo docs, excluidos del push CI por paths-ignore existente; no usa una excepción nueva ni skip-ci.
- Cerrado el pendiente de acreditar ciclos del worker actual mediante SUPERADMIN. La nueva telemetría está versionada pero no instalada en 488a518; una futura publicación expresamente autorizada deberá incluirla. El controlador exige dos muestras frescas de avance antes de declarar éxito. Se mantiene la supervisión ordinaria de ciclos y errores.
- El primer recorrido completo de publicación productiva queda para una autorización funcional. La autonomía cubre el procedimiento previsto, no reparaciones arbitrarias después de una migración fallida.
- Pendiente del titular: política de retención y copia externa. No se borran backups automáticamente. El restore está preparado para PostgreSQL 17 e imagen fijada; cambios de versión, extensiones o volumen requieren revisión. PM2 detenido y una instantánea de actividad no garantizan que un cliente externo idle no vuelva a escribir: comprobar que no existan escritores de aplicación fuera del inventario.

El proceso independiente sigue la semántica de [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html). El trabajo ajeno en node_modules/.package-lock.json se conserva fuera de los commits de configuración y cierre.
