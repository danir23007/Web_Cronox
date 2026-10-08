# Favoritos del administrador — 08/10/2026
> Actualización del 8 de octubre: esta mejora está publicada en producción con `4ecb273`; el ajuste posterior del visor táctil se incluye en `c2488d4`. Los apartados de implementación local describen la fase previa. Commits, migraciones, reparaciones y límites de verificación publicados: [informe de publicación](session-release-2026-10-08.md).

Implementado en local, sin commit, push, despliegue ni modificaciones en producción. Cambios anteriores conservados. No hay `AGENTS.md` en el repositorio ni en sus ascendientes; el archivo global revisado no contiene instrucciones.

Abrir **Producto → Favoritos**, junto a Waitlist, o **http://localhost:3000/admin.html#section-favorites** con una cuenta administrativa. Se reutilizan las filas, filtros y paginación adaptables de Waitlist y el editor real de productos. El backend protegido local se ha recompilado y reiniciado; no hay migración nueva para este módulo.

## Qué cuenta

El modelo `Favorite` guarda una relación actual entre `userId` y `productId`, con restricción única conjunta. `FavoritesService.add` utiliza upsert; `remove` y la desactivación mediante `toggle` eliminan la relación. Los dispositivos de una misma cuenta comparten su identidad y no suman personas adicionales. Los eventos históricos `FAVOURITE_ADDED/REMOVED` no participan en este informe. Tampoco se consultan visitas, carritos ni newsletter.

El cliente actual (`FavoritesManager` en `app.js`) carga y modifica los favoritos mediante endpoints autenticados y solicita iniciar sesión al visitante anónimo que intenta guardar uno. El servidor no tiene un conjunto de favoritos anónimos que pueda sumar. La interfaz explica que **solo se incluyen favoritos vinculados a cuentas**, sin atribuir cifras a los que pudieran conservarse únicamente en un navegador o en clientes antiguos. No se ha cambiado el sistema de guardado/sincronización. Se incluyen todas las relaciones válidas, sin filtrar por contraseña, suscripción, estado o rol de la cuenta.

## Consulta y presentación

`GET /api/admin/favorites?search=...&sort=desc&page=1` utiliza exactamente `JwtAuthGuard`, `AdminGuard`, `RolesGuard` y la declaración de roles de gestión de productos. La utilidad de roles existente admite ADMIN/SUPERADMIN; no se han ampliado permisos. Invitados, USER y FRIEND quedan excluidos. Los parámetros se validan: búsqueda hasta 120 caracteres, dirección `asc|desc`, página entera positiva hasta 100000.

Una única sentencia SQL parametrizada agrupa en PostgreSQL y obtiene página, total filtrado y resumen global bajo el mismo snapshot. Las relaciones se deduplican por usuario/producto y se unen con usuarios y productos existentes, excluyendo huérfanos. Parte de todos los productos mediante LEFT JOIN, por lo que también devuelve cero favoritos e inactivos. Agrega variantes e imágenes dentro de la misma sentencia, sin consultas de aplicación por fila ni información personal de usuarios en la respuesta.

- Filas: miniatura, nombre, ID, SKU de referencia y slug, estado activo/inactivo, disponibilidad y usuarios que lo tienen guardado. La referencia mostrada es el primer SKU en orden léxico; la búsqueda revisa todos los SKU del producto. Disponibilidad utiliza el criterio existente de Waitlist: producto activo y alguna variante activa con stock positivo. Los productos archivados/desactivados tienen `isActive=false` y se identifican como inactivos/archivados; no hay estado de archivo independiente en este modelo.
- Orden predeterminado: favoritos descendentes, ID ascendente en los empates. Permite invertir la cantidad. Búsqueda parcial sin distinción de mayúsculas por nombre/slug/SKU, o ID exacto; `%`, `_` y barras se escapan como texto, sin ampliar accidentalmente los resultados.
- Página: 25 productos. El total de productos y las páginas corresponden a la búsqueda.
- Resumen: **todos los productos**, incluidos inactivos, independientemente de la búsqueda/página. Total de relaciones actuales y usuarios distintos con al menos una. Tres productos de una cuenta suman tres favoritos y un usuario. Las etiquetas explicitan el alcance global.
- Actualización: nueva consulta al abrir, pulsar Actualizar, buscar, ordenar o cambiar de página. No se guardan agregados ni se necesita reiniciar el servidor después de añadir/quitar favoritos. Aborto y versión evitan respuestas antiguas. Ante fallos se limpian las cifras, se muestra «Resumen no disponible» y se permite reintentar, sin simular cero.
- Editar abre el modal existente con el producto seleccionado. Los filtros están exentos del aviso de edición pendiente mediante la clase de filtros ya utilizada por el shell.

Recursos: nuevo `admin-favorites.js?v=1`; `admin.js` pasa de caché 14 a **15**. No ha sido necesario cambiar CSS: se reutiliza `waitlist.css`. Los cambios de caché de tareas anteriores permanecen.

## Verificación

**27 pruebas / 5 suites correctas**, incluidos autorización/validación HTTP real de Nest, contrato SQL, rechazo de respuestas obsoletas, errores/reintento y pruebas existentes de navegación, autenticación y pedidos:

```powershell
npm test --prefix cronox-backend -- --runInBand src/admin/favorites src/frontend/admin-favorites.dom.spec.ts src/frontend/admin-preview-navigation.spec.ts src/frontend/admin-auth-flow.dom.spec.ts src/frontend/admin-orders.dom.spec.ts
```

**PostgreSQL real desechable** con esquema Prisma actual, sin conexión con bases comerciales, mediante `node cronox-backend/scripts/review-admin-favorites.cjs`: servicios reales de añadir/quitar, repetición desde la misma identidad, tres productos de una cuenta, varios usuarios de un producto, cuentas sin contraseña/PRE_REGISTERED, ceros, empates estables, producto inactivo, stock cero, 28 productos en dos páginas, búsqueda por SKU/ID, caracteres especiales, parámetros hostiles, resúmenes globales sin cambios al filtrar/paginar y eliminación de un producto sin favoritos. Se contrastan los agregados con las relaciones persistidas y se vuelve a consultar después de quitar. La instancia se detiene y elimina al terminar; no genera visitas, envíos ni correos.

**Base local normal, solo lectura**, mediante `node cronox-backend/scripts/read-admin-favorites-local.cjs`: 7 productos, 0 favoritos y 0 usuarios con favoritos al verificar. Coinciden el listado y los recuentos persistidos. El lanzador protegido rechaza bases remotas. No se añadieron ni quitaron favoritos en esta base para probar.

**Chromium real**: administrador completo en servidor aislado de lectura en loopback, con autenticación y respuestas del módulo simuladas exclusivamente en el navegador. Escritorio 1440×1100 y móvil táctil 390×844: menú Producto/Favoritos junto a Waitlist, miniaturas, ceros/inactivos, resúmenes, paginación, búsqueda SKU/ID, orden, modal real de edición, HTTP 503/reintento y nueva respuesta. Sin desbordamiento horizontal ni errores JavaScript/diálogos inesperados. Capturas inspeccionadas visualmente. Esta revisión de datos simulados se distingue de la comprobación persistida anterior; el módulo de producción consulta únicamente Favorite real.

| Escritorio | Móvil |
| --- | --- |
| [Favoritos](../output/playwright/admin-favorites/desktop.png) | [Favoritos](../output/playwright/admin-favorites/mobile.png) |

[Resultados del navegador](../output/playwright/admin-favorites/report.json). Repetir con `node tests/admin-map/review-server.cjs` y:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=favorites open about:blank
npx --yes --package @playwright/cli playwright-cli -s=favorites run-code --filename=tests/favorites/admin.cli.js
```

Backend `npm run build:compiled --prefix cronox-backend`, administrador `npm run admin:build`, sintaxis de JavaScript y ESLint de controlador/servicio nuevos: correctos. No se ha realizado una prueba de carga ni consultado o modificado favoritos de producción. La consulta global debe recorrer las relaciones actuales para contar usuarios distintos; no se introducen índices/migraciones sin evidencia de necesidad.

## Producción tras el despliegue

El servicio desplegado, consultado en READ ONLY contra los datos reales, devuelve siete productos, tres favoritos actuales y tres usuarios únicos. Los recursos públicos coinciden con la versión revisada y el endpoint exige autenticación (401 sin sesión). No se añadieron ni quitaron favoritos reales. La pantalla administrativa autenticada permanece pendiente de comprobación visual por ausencia de sesión autorizada disponible.