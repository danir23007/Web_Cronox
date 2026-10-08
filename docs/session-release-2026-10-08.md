# Publicación de las mejoras de la sesión — 8 de octubre de 2026

## Alcance y preparación

La lectura de Git, remoto y VPS confirmó `c83eb3cb95e0687939014316f1e8e37b47102875` como base publicada. El Mapa inicial y la protección principal de newsletter ya formaban parte de esa base; la ampliación territorial, identidad, vinculación de newsletter, Live stats, Favoritos, carrusel y correo de contacto seguían en local. Se publican juntos, conservando esos comportamientos existentes.

No existe `AGENTS.md` en el repositorio ni en los ascendentes; el global está vacío. No se añaden migraciones duplicadas ni se alteran las aplicadas. Las dos preparadas preservan los ID internos y sus relaciones, códigos emitidos y tokens QR, reservan identidades incluso tras borrar cuentas y rechazan colisiones. No hay inventario de acreditaciones eliminadas anterior a la reserva; sigue vigente la limitación histórica del informe de identidad.

El cierre de sesión tenía dos limpiezas de `sessionStorage` que podían borrar la marca de newsletter. Ambas conservan ahora `cronoxNewsletterShown`, incluso tras recargar o volver a crear el controlador. Se incrementan `app.js` a v90 y `profile.js` a v20. La prueba nueva confirma conservación de la marca y eliminación de la caché privada de cuenta.

## Respaldo y recuperación

Copia privada recuperable de todo el esquema de aplicación `public` en el VPS:
`/home/deploy/cronox-release-backups/session-20261008-joXODH/database.dump`.
SHA-256: `aa821fad5b25e5b117ee1a5b0994133dcbecd154cc81cc663ddf7ea32b8096d1`.

Antes del despliegue se restauró realmente en PostgreSQL 18.6 aislado, socket Unix privado, sin TCP ni aplicación/trabajadores. Se verificaron 40 usuarios y cinco suscripciones y se ejecutaron las dos migraciones sobre esa restauración: ID internos, códigos emitidos y QR conservados. El clúster de verificación se detuvo. Esta copia no incluye esquemas gestionados por Supabase ni ficheros privados de correo; estos no se modifican en esta publicación. Dump, inventario detallado y logs están fuera del checkout, con permisos privados, sin credenciales ni datos personales en el commit.

Ante un problema, conservar el código compatible con las migraciones aditivas y corregir hacia delante. Para investigar una recuperación de datos, restaurar primero el dump en una instancia aislada siguiendo la verificación del operador `scripts/release-session-production.cjs`; comparar registros y reconciliar las escrituras posteriores. No restaurar todo sobre producción automáticamente, no resetear y no borrar reservas o cuentas. Un rollback de código debe revisarse por compatibilidad: la creación antigua de usuarios podría intentar cambiar códigos ahora inmutables. Las cuentas nuevas reparadas no deben eliminarse como supuesto rollback.

## Validación previa

- Prisma 6.19.3: esquema válido, cliente generado y backend Nest compilado.
- Vite 7.3.6 / Node 22: build del panel correcto, SVG local de 19 comunidades y 52 provincias/ciudades generado e incluido junto a GeoJSON y licencia.
- Jest completo: 209 suites y 1.968 pruebas correctas. Tras el ajuste adicional de logout: 40 pruebas correctas en cuatro suites, incluida una nueva; total de casos del conjunto final: 1.969.
- PostgreSQL desechable: identidad/migraciones/newsletter concurrente/reparación, favoritos persistidos y presencia/deduplicación/caducidad correctos.
- Exportaciones CI: 59 pruebas; verificaciones de artefactos y rutas compiladas correctas.
- Cinco errores en `tsc -p tsconfig.admin.json --noEmit` siguen pendientes: stock posiblemente indefinido y cuatro métodos ausentes de la declaración de API. Se reprodujeron exactamente los mismos cinco sobre los archivos extraídos del commit base, cambiando únicamente la ruta del import para ejecutar esa copia aislada. No hay errores nuevos; el chequeo no se declara aprobado ni se desactiva.
- Se corrigieron fixtures de Bulk Edit para cargar el formateador real y expectativas de caché/allowlist de recursos para las nuevas versiones y la cartografía autorizada.

## Flujo de publicación

GitHub Actions de `main` valida y despliega. Genera Prisma, aplica `migrate deploy`, compila y reinicia una sola vez por release. El wrapper actualiza por `git merge --ff-only` y usa `deploy-vps-release.sh` con la misma secuencia; no usa el `reset --hard` del script antiguo. Se preserva el archivo ajeno `cronox-backend/src/main.ts.cronox-before-stripe` del VPS. Los cambios solo en `docs/**` no reinician una aplicación cuyo código no cambió.

La reparación autorizada se ejecutará después de migrar y con dry-run previo. El operador no inicia Nest ni servicios de correo. Vincula exclusivamente suscripciones confirmadas pendientes, sin contraseñas, fusión, borrado ni trabajos de correo. Verifica los dos ejemplos mediante variables efímeras y solo registra alias y sus ID/códigos. La reparación del contenido editable modifica solo coincidencias, conserva el resto e incrementa revisión; la auditoría previa encontró cero coincidencias.

Los resultados concretos de commit, workflow, reparaciones y verificaciones publicadas se incorporarán al cierre de este informe. No hay una sesión administrativa de navegador disponible: no se afirmará haber visto las pantallas reales con sesión iniciada si el acceso sigue ausente.
