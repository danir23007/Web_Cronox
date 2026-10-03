# Reconciliación diaria de visitantes

Implementada y probada en local el 2 de octubre de 2026 y publicada el 3 en `2c508b7`, con la migración aplicada mediante el despliegue existente. El histórico financiero se conserva. Fechas de activación y evidencia de producción en [el registro de publicación](admin-publication-2026-10-03.md).

## Recuento y evidencia

Antes, cada categoría tenía su propia clave única: un navegador anónimo y la cuenta posterior podían aparecer simultáneamente. Los administradores autenticados también se contabilizaban.

Ahora cada cuenta USER/FRIEND cuenta una vez por día natural de Europe/Madrid, entre dispositivos. Un navegador anónimo consentido cuenta una vez. Cuando ese navegador accede a una cuenta verificada, el anónimo queda marcado como vinculado y deja de sumarse. Logout, recargas, pestañas y reintentos no añaden otro anónimo ese día. Varios navegadores vinculados a una cuenta producen una cuenta; dos cuentas legítimas en un navegador compartido producen dos cuentas, sin anónimo adicional.

ADMIN/SUPERADMIN no generan registros autenticados. Su navegador queda excluido para el resto del día y su anónimo identificable se marca como excluido. Las cuentas legítimas previamente registradas en ese navegador se conservan. La navegación exclusiva del panel no registra visitas. Un administrador desde un navegador desconocido sin sesión es indistinguible de cualquier anónimo; no se intenta reconocerlo mediante IP ni fingerprinting.

Los hechos originales permanecen en `DailyVisitor`. Se añaden `disposition` y `observedRole`, un estado por navegador/día en `DailyVisitorBrowser` y relaciones verificadas en `DailyVisitorLink`. El rol observado al crear un registro autenticado permanece; promover después a esa cuenta no borra su historial legítimo. Los timestamps de la cuenta corresponden a sus registros identificados, no a la duración de una sesión. Las entradas anónimas originales mantienen sus propios timestamps.

La vista SQL privada `CountedDailyVisitor` es la definición común de gráfica, totales, detalle, búsqueda, categorías y paginación. No existen exportaciones de visitantes en el módulo de exportaciones actual. No se ocultan administradores solamente en el frontend ni se mantienen contadores que puedan quedar negativos.

## Identificación, acceso y concurrencia

El identificador libre de localStorage anterior no sirve como prueba segura: cualquiera podría proporcionar un UUID conocido y reclamar su visita. No se transforma en una relación histórica. Se retira del almacenamiento al activar o desactivar el servicio.

El servidor emite una prueba aleatoria de 256 bits en `cronox_daily_visitor`, HttpOnly, SameSite=Lax, Secure en producción y Path=/api. Solo conserva su SHA-256; no reutiliza tokens de autenticación ni devuelve la prueba en JSON. Caduca a la siguiente medianoche de Madrid, también en jornadas de 23/25 horas. Cada nuevo día utiliza otra prueba y reevalúa sesión y roles. No existe seguimiento anónimo sin consentimiento versión 2.

La sesión la verifica Passport y se vuelve a comprobar al registrar. Las credenciales inválidas, una renovación pendiente o un fallo temporal de autenticación no se convierten en invitados. Un guard previo a los pipes rechaza identidades, roles y UUID enviados en el cuerpo. La cuenta procede exclusivamente de la identidad verificada en el servidor.

El puente se ejecuta tras login, registro, renovación y enlaces de lanzamiento/newsletter. Solo crea una cuenta desde ese puente si el navegador ya tenía una visita pública; acceder exclusivamente al panel no cuenta. Las sesiones persistentes también se identifican al registrar la página pública. El estado analítico no concede permisos y permanece independiente del logout real. Si el puente falla por infraestructura, no bloquea el acceso y avisa sin imprimir secretos; el registro público con sesión permite reintentar la vinculación.

Web Locks serializa la emisión inicial y el registro entre pestañas. Sin Web Locks, no se emite una nueva prueba anónima: se puede reutilizar una prueba válida o contar la cuenta verificada sin ella. No hay un identificador efímero ni fingerprint como alternativa. Cookies bloqueadas, borradas o retiradas impiden relacionar visitas; no se promete reconocer personas entre navegadores que nunca acceden a la misma cuenta.

La base bloquea la fila de navegador con `FOR UPDATE` durante toda la conversión. UPSERT y claves únicas respaldan la cuenta diaria y las relaciones. La conversión y su clasificación son una transacción; las consultas de detalle/gráfica usan Repeatable Read. El estado sobrevive al reinicio y la coordinación no depende de la memoria del proceso. Primera emisión entre pestañas exige el Web Lock; solicitudes manuales sin una prueba previa no permiten reconocer que pertenecen al mismo navegador.

Retirar el consentimiento cancela registros pendientes y elimina la prueba mediante un endpoint independiente de autenticación, protegido por el guard global de CSRF/origen. Funciona también con credenciales caducadas. No elimina los hechos ya registrados. Si la red impide la limpieza, no se realizan nuevos registros sin consentimiento y la cookie vence igualmente a medianoche.

## Histórico y fecha fiable

La implementación anterior no guardaba la relación navegador/cuenta ni el rol observado. `AuthSession` y `AnalyticsSession` tampoco permiten demostrar esa relación o el rol de cada visita diaria. No se ha inventado ningún backfill a partir del usuario actual, IP, sesión de acceso o UUID presentado por el cliente. Los registros antiguos desconocidos permanecen contabilizados; pueden conservar dobles categorías y administradores no identificables históricamente.

Una vinculación solo reclasifica el anónimo que posee prueba de servidor válida para ese mismo día; las relaciones nuevas se conservan como evidencia. Se prueba expresamente la conservación de históricos sin evidencia y la reconciliación de hechos identificables. No se consultaron ni modificaron visitas reales de producción.

`VisitorHistoryConfig.startedAt` permanece intacto y protegido. Días anteriores siguen siendo `null` / «Sin datos». La nueva migración añade `deduplicationStartedAt` con el timestamp del inicio de su transacción, sin ejecutar UPDATE sobre la fila protegida. La interfaz muestra ese marcador y advierte que el histórico anterior y el día de transición pueden contener reglas mezcladas. **Todavía no hay una fecha de activación en producción:** debe anotarse al completar el despliegue coordinado. La garantía para un día completo comienza en la primera medianoche de Madrid posterior a completar la publicación; los registros nuevos verificados ya obedecen las reglas desde que funciona el backend nuevo.

## Migración y comprobaciones

Nueva migración: `20261002200000_visitor_daily_reconciliation`. Añade columnas, tablas, restricciones y vista en una transacción. No borra datos, no reescribe fechas originales, no modifica migraciones aplicadas y no usa reset. Las tablas/vista nuevas tienen RLS y permisos revocados a PUBLIC, anon y authenticated. El rol privado del backend debe conservar acceso a ellas como al histórico existente.

Resultados:

- Backend compilado con Prisma generado y frontend compilado con Vite; scripts de visitantes comprobados sintácticamente.
- 92 tests Jest aprobados en 15 suites: visitantes, métodos de acceso, autenticación, analítica, finanzas y correo.
- 30 grupos de integración aprobados con PostgreSQL 17 efímero y Nest/Passport reales: los 16 casos solicitados, roles posteriores, credenciales inválidas, outage 503, revocación de consentimiento, estado tras reiniciar, filtros y permisos administrativos. Tres procesos independientes ejecutan 45 solicitudes contra el mismo navegador, sin duplicados.
- Chromium: dos pestañas iniciales producen un anónimo; login lo convierte sin sumar otra cuenta; logout conserva el total; retirada elimina la cookie HttpOnly; outage 503 no envía un registro anónimo. La cuenta también se cuenta sin Web Locks.
- Panel a 1440×1000 y 390×844: gráfica/detalle coherentes, dos cuentas en navegador compartido, categoría anónima vacía, búsqueda por cuenta y ausencia de desbordamiento de página. Las capturas temporales no se incorporan a Git; las pruebas reutilizables están en [tests/admin-review](../tests/admin-review/README.md).

Las pruebas solo crean usuarios y visitas sintéticos en bases nuevas ligadas a 127.0.0.1. No ejecutan compras/cobros/reembolsos ni contactan proveedores. La migración de correo pendiente, si existe en el checkout, se aplica solamente a esa base temporal para que su indicador del panel pueda cargar; no se alteran sus archivos ni se ejecutan acciones sobre buzones. Los servidores de prueba se detienen al terminar.

Para reproducir desde la raíz:

```powershell
npm run build --prefix cronox-backend
npm run admin:build
npm test --prefix cronox-backend -- --runInBand --testPathPatterns="visitor|finance|analytics|auth.controller|session-permission|mailbox"
node cronox-backend/scripts/review-visitors.cjs
# Revisión aislada: --serve, luego abrir el enlace local indicado. Escribir stop para cerrar.
node cronox-backend/scripts/review-visitors.cjs --serve
```

Las funciones para Playwright CLI se conservan en `tests/visitors/`: abrir el enlace `/__visitorreview/SUPERADMIN`, ejecutar `run-code --filename tests/visitors/review-admin.js`, `review-mobile.js` y `review-public.js`, en ese orden. Las pruebas públicas deben comenzar desde el panel, para no dejar anónimos previos sin identificar al limpiar cookies.

## Publicación pendiente

Revisar y preparar un commit selectivo de visitantes, incluyendo solamente sus hunks del esquema y de `admin.html`; conservar el trabajo de correo separado. Revisar las migraciones realmente incluidas en esa publicación. Coordinar migración, backend y frontend mediante el despliegue existente, que ejecuta `prisma migrate deploy`; no aplicar todavía nada en producción. Invalidar cachés con las referencias nuevas: cookie-consent v6, visitor-history v2 y admin-visitors v2. Las páginas públicas solo cambian esas referencias de recursos.

Tras publicar, seguir el workflow hasta su resultado y comprobar en producción salud/migraciones, recursos y panel, registro/deduplicación y roles administrativos. Registrar hora de migración, hora de activación completa y primera jornada fiable. La fecha de inicio original del histórico no cambia.

Para revisar los assets del panel en local, ejecutar **`npm run admin:watch`**.
