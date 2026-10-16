# Publicación de METACRILATOS y Eventos QR · 17/10/2026

## Versión publicada

El despliegue habitual terminó correctamente el 17 de octubre de 2026 a las 00:53, hora de Madrid. El servidor ejecuta `d9d67f48f214acf2a5b5b0da320db9c9d7586f25`.

- `bc49fdf`: gestión persistente de diseños y vistas previas protegidas, anteriormente pendiente de push.
- `d9d67f4`: familia METACRILATOS, identidad QR persistente, Eventos QR y todos los ajustes pendientes de presentación, movimiento y pruebas.
- [CI del push](https://github.com/danir23007/Web_Cronox/actions/runs/38977281487): correcto.
- [Verificación y despliegue explícito](https://github.com/danir23007/Web_Cronox/actions/runs/38977692855): correctos.

Este informe se incorpora después en un commit exclusivamente documental. No cambia el código ejecutado ni requiere otra migración o reinicio. El workflow excluye los cambios exclusivos de `docs/`.

## Resultado funcional

El perfil y la preview administrativa mínima comparten presentación y privilegios. El perfil conserva los datos autorizados; la preview identifica sus datos ficticios y usa un QR inválido. Los selectores de círculo y anchura no guardan configuración ni activan diseños. El enlace a la tienda ocupa una fila inferior común, con texto un 12,5 % menor y área mínima de 44 px. Se mantiene el tamaño de la composición; cuando falta altura, el pie continúa después del contenido, conforme a la elección expresa del usuario.

Se incluyen los cinco diseños aprobados, sus indicadores, personalización, giro automático, control único y espera de siete segundos, junto con grupos de Eventos QR, lectura por cámara y protección contra registros duplicados. La corrección mínima de WebKit oculta la cara que el renderer ya marca como no visible; no modifica geometría, reflejos ni movimiento. La acreditación original del libro y las reglas comerciales se conservan.

**La selección activa de producción sigue siendo `original`, con su artwork anterior. METACRILATOS está disponible, pero este despliegue no lo activa.**

## Respaldo y migraciones

Respaldo consistente previo: `/home/deploy/cronox-release-backups/metacrilatos-tDfYYE`, directorio 700 y archivos 600. Dump PostgreSQL de 1.155.670 bytes, SHA-256 `e38e0096bb7e06282c1b7c8df6ed5394fa90dda9e0798dfbce4554d0a0f6a739`.

Se restauraron realmente las 106 tablas de aplicación de `public` y `cronox_private` en PostgreSQL aislado, sin TCP ni workers, conservando datos, propietarios, ACL, RLS, funciones y políticas. Las dos migraciones se ensayaron allí antes de tocar producción. El dump incluye esquemas gestionados de Supabase, pero la restauración comprobada cubre los esquemas de aplicación; no incluye archivos binarios de Storage ni sustituye la recuperación de los servicios gestionados del proveedor.

Prisma aplicó únicamente las dos migraciones pendientes:

1. `20261016120000_accreditation_designs`.
2. `20261016160000_metacrilatos_qr_events`.

La auditoría posterior confirma el historial completo de migraciones con checksums coincidentes y ninguna migración fallida. Se conservan los 51 usuarios, sus identidades y códigos, los cuatro QR preexistentes y ocho tablas de configuración. Se completan únicamente los 47 tokens personales antes nulos. Los grupos y participantes de eventos están vacíos: ninguna prueba creó inscripciones en producción.

Una comparación completa posterior confirma que todas las demás columnas de `User` y del registro de identidades son idénticas al respaldo. Ambas tablas QR tienen RLS habilitado, ACL exclusiva del propietario y ningún permiso de lectura/escritura para `anon` o `authenticated`; el índice único `(groupId, userIdentityUid)` está presente, válido y listo. La actividad normal de correo solo actualizó fechas de sincronización y leases en cuatro buzones y fechas en veinte carpetas, sin cambios de configuración, credenciales ni contenido. Todas las consultas de auditoría productiva fueron `READ ONLY`.

## Comprobaciones

- CI completo: **249 suites y 2.585 pruebas**, más **59 pruebas de exportaciones** y 13 verificaciones del procedimiento de despliegue. Typechecks y compilaciones correctos.
- Navegador local: **86 pruebas aprobadas, nueve omisiones intencionadas y cero fallos**. Cinco círculos, libro, perfil, preview completa, desktop/móvil, resize, QR, giro, pausas, gesto prolongado, cancelación y cierre/reapertura.
- En localhost con sesión y base reales: diez combinaciones de preview, perfil autorizado y comparación íntegra de diseños/selección antes y después, sin escrituras por manipular la muestra.
- Lector QR: 151 casos sintéticos. Ensayo de Eventos QR en base desechable: persistencia, identidad, autorización y concurrencia sin duplicados.
- WebKit automatizado: defecto reproducido también con dos caras HTML aisladas; orientación y lectura correctas tras la regla de compatibilidad. En Chromium, 65 poses comparadas conservan exactamente los píxeles RGB.
- Producción: salud y disponibilidad **200**; `/cuenta` sirve las nuevas referencias; **16 archivos servidos coinciden byte a byte con los blobs Git del commit desplegado**. Seis rutas privadas devuelven **401** sin sesión y administración redirige a su login. La API pública devuelve `original / original-v1`.

La inspección visual autenticada se realizó en localhost. No había una sesión administrativa legítima disponible para recorrer la interfaz privada de producción; no se crearon sesiones ni se trasladaron credenciales locales. Las verificaciones online cubren archivos, rutas, servicio y base de datos. No se han probado teléfonos ni cámaras físicos: WebKit/iPhone y los gestos móviles son simulados, al igual que la captura de cámara mediante canvas. Queda la comprobación física descrita en `metacrilatos-eventos-qr.md`.

## Estado y evidencias

El código de aplicación queda publicado y sin cambios locales pendientes. Las evidencias y herramientas privadas permanecen ignoradas bajo `output/`; se eliminó el archivo temporal de sesión del navegador y se cerró el servidor estático de pruebas. El servidor local normal sigue disponible.

En el VPS se conservó el archivo ajeno `cronox-backend/src/main.ts.cronox-before-stripe`. Las diferencias de `node_modules` corresponden a dependencias históricamente versionadas y regeneradas por el `npm ci` habitual; no se descartaron mediante reset. No hay otros archivos de producto pendientes en ese checkout.

Capturas finales locales: `output/playwright/release-profile-desktop.png`, `release-profile-mobile.png`, `release-preview-desktop.png`, `release-preview-mobile.png` y `release-admin-complete.png`. Informes privados: `output/metacrilatos/release/local-presentation-qa.json`, `production-http-after.json`, `final-backup-manifest.json`, `final-recovery-verified.json` y `post-deploy-audit.json`. Los diagnósticos y el dump recuperable permanecen fuera de Git.
