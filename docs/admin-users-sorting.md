# Listado de Usuarios: filtros, ordenación y facturación

Preparado solo en local, conservando la exclusión estadística de compras manuales.
No cambia cuentas, autenticación, contraseñas, estados internos ni numeración.

## Interfaz

Se retira el filtro de estado de cuenta. Los parámetros antiguos `accountState`
del hash y de la consulta se eliminan al entrar en Usuarios; el backend ignora
ese campo legado tanto en el listado/selección masiva como en su exportación.
La columna Estado y los controles protegidos de edición de cuenta se conservan.

Ordenar por y Dirección se muestran fuera de Filtros y búsqueda. Las opciones
son ID, Facturación, Número de pedidos y Prendas diferentes adquiridas, con ambas
direcciones. Cada entrada nueva empieza por ID descendente, incluida una URL
con ordenación antigua. Buscar, filtrar, limpiar filtros y paginar dentro de la
vista conservan la elección. En móvil los controles ocupan filas completas.

Facturación aparece entre Nombre y Rol. Se formatea en EUR con dos decimales;
sin compras se muestra `0,00 €`. La pantalla usa los mismos céntimos enteros que
el servidor emplea para ordenar. Se conservan selección, acciones y enlaces con
`identityUid` para evitar abrir una cuenta distinta si cambia su numeración.

## Reglas

- **ID:** `User.id` es actualmente la numeración correlativa ya implementada y
  expuesta como `registrationNumber`/N.º. `identityUid` sigue siendo la identidad
  inmutable. Esta tarea no renumera ni modifica ninguno de estos campos.
- **Facturación:** precios históricos pagados, descuentos y reembolsos del motor
  financiero compartido, excluyendo envío. Las compras manuales excluidas y los
  cancelados no contribuyen. No se consulta el precio actual del catálogo.
- **Pedidos:** ventas pagadas/confirmadas que admite el motor financiero,
  excluyendo cancelados y compras manuales excluidas. Como en Finanzas, una
  devolución ajusta dinero y prendas, sin borrar el pedido pagado original:
  un pedido devuelto total o parcialmente cuenta una vez, nunca como otro pedido.
- **Prendas diferentes:** productos con unidades netas positivas, agrupados por
  ID de producto. Varias unidades/tallas del mismo producto cuentan una vez;
  dos productos con el mismo nombre mantienen identidades distintas. Una
  devolución monetaria total deja cero prendas adquiridas incluso sin reposición
  de stock. Las devoluciones parciales usan la evidencia de unidades del motor.
- Los usuarios sin compras tienen cero. Los puntos de venta sin cliente no se
  atribuyen a usuarios. No se mezclan importes en distintas monedas ni se inventan
  ingresos cuando el motor financiero detecta un reembolso sin reparto fiable;
  esos casos muestran No disponible y se ordenan al final en ambas direcciones.
- La ventana acumulada llega al día actual de Madrid, siguiendo las fechas del
  motor financiero. Un coste desconocido no impide mostrar ingresos conocidos.

## Servidor y archivos

`src/admin/users/user-purchase-metrics.ts` consulta titulares de pedidos y lee
archivos, eventos y movimientos en lotes de 200, sin una consulta por usuario.
Reutiliza `calculateFinance` y `countsInStatistics`; no guarda métricas cacheadas
que queden obsoletas después de registrar, devolver o excluir compras.

`admin-users.service.ts` ordena numéricamente el conjunto filtrado completo antes
de paginar, dentro de RepeatableRead. En los empates usa la numeración descendente
(única) de forma estable. No carga hashes de contraseñas ni campos privados de
autenticación para construir la lista. El DTO valida las cuatro claves y ambas
direcciones. Se mantienen los permisos del listado y de las finanzas privadas.

También se actualizan:

- `src/admin/exports/admin-exports.service.ts` y su DTO: mismas métricas y
  ordenación en exportaciones de Usuarios; se mantiene el límite de exportación.
- `cronox-front/admin.html` y `assets/admin.js`: controles, columna, URL y estado.
- Pruebas de métricas, exportaciones, paginación y servicio de usuarios.
- `scripts/user-list-review-fixtures.cjs`, escenario de integración en
  `scripts/test-manual-statistics-db.cjs --users-list --serve` y
  `tests/admin-review/users-list-browser.cjs`.
- Pruebas de numeración `review-user-numbering-local.cjs` y
  `user-numbering-http.cjs`: orden ascendente explícito y comprobación del nuevo
  predeterminado descendente tras una baja real en su clúster desechable.

## Comprobaciones

337 pruebas automatizadas relacionadas pasan. PostgreSQL/Nest reales con 106
usuarios sintéticos verifican las ocho ordenaciones completas entre páginas,
empates, ceros, precios manuales personalizados, tallas, identidad de productos,
devolución total, exclusión/reinclusión y ausencia de restricciones por estado.
La revisión real de numeración verifica baja, referencias e identidades y orden
ascendente/descendente después de compactar únicamente sus fixtures.

Playwright verifica la interfaz real a 1440 px y 390 px: las ocho ordenaciones,
ambas páginas, búsqueda/filtros, selección, enlaces de acciones, posición y
formato de Facturación, URL antigua saneada y vuelta a ID descendente al
reentrar. Las capturas están en `output/playwright/users-list-*.png`.

La prueba intensiva usa una ventana de rate limit de un segundo solo en el
servidor desechable; no modifica los límites del localhost habitual ni producción.
No hay migración nueva para estos cambios. El localhost habitual conserva sus
datos y sirve la funcionalidad en `http://localhost:3000/admin.html#usuarios`.
