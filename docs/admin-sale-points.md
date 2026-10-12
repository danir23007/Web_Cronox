# Clientes → Puntos de venta

Implementación local de tiendas, eventos/ediciones y otros puntos. No crea `Order`, clientes, pagos, envíos ni emails. La recuperación de los pedidos #19/#20 no forma parte de esta funcionalidad.

## Datos y migración

`20261011215858_external_sale_points` añade:

- `SalePoint`: configuración, edición y archivado con revisión.
- `PointSale`: estado vigente de cada venta, fecha original y revisión.
- `PointEntry`: historial inmutable de importes, gastos, correcciones y devoluciones, con autor, fecha efectiva, fecha de registro y valores anteriores/posteriores. Clave de idempotencia única y huella de la solicitud.

Las tres tablas tienen RLS y revocación de permisos públicos/anon/authenticated. La API requiere JWT y rol ADMIN/SUPERADMIN, igual que finanzas e inventario. Un trigger impide UPDATE/DELETE de asientos. Los precios y costes privados solo aparecen en endpoints de administrador. No se asigna la ciudad del punto al comprador ni se crean destinos para el mapa.

La migración se prueba contra una base vacía **desechable en loopback**, después de crear el esquema anterior. No se ha aplicado a producción ni a la base habitual de desarrollo. Para usar la funcionalidad en otro entorno hay que aplicar esta migración con el procedimiento de despliegue del proyecto y regenerar Prisma.

## Reglas contables

- Moneda EUR, como los costes privados configurados. Importes en céntimos enteros y comisiones en puntos básicos (0–10000 = 0–100%). Comisión redondeada por línea al céntimo más próximo, mitades hacia arriba, mediante aritmética entera.
- Ingreso = precio pagado introducido × cantidad. Coste = coste privado configurado al registrar × cantidad, aunque la venta sea anterior a su actualización. Ausencia de coste bloquea el registro e identifica el producto; cero explícito es válido.
- Precio, coste y comisión se congelan. Los cambios de configuración no recalculan ventas previas. El ingreso se muestra antes de comisiones y el importe para CRONOX por separado. No hay envío ni Stripe en estas ventas.
- Gastos independientes por fecha, descontados una vez. El gasto inicial de participación se registra con la creación. Una anulación genera un asiento contrario fechado; no borra el original. Los días con solo gastos figuran en gráfico y calendario.
- Correcciones por diferencias en su fecha efectiva: cantidad, precio, comisión, notas y método. Se conserva el coste de las líneas existentes. Para cambiar de talla se retira la línea incorrecta y se añade la correcta; ambas dejan evidencia de stock. Las líneas con devoluciones permanecen en el historial, con cantidad pendiente editable (incluido cero).
- Una devolución descuenta ingreso y unidades; devuelve coste **solo si se repone stock**, manteniendo la regla del sistema existente. La comisión recuperada se introduce expresamente en céntimos y puede ser cero. No afecta a gastos fijos.
- Las correcciones posteriores a devoluciones afectan a las unidades pendientes, manteniendo la comisión retenida/recuperada anteriormente y los costes de prendas no repuestas. No se permiten comisiones resultantes negativas ni ajustes anteriores al último movimiento de la venta.
- Número de ventas = registros originales en el periodo, sin contar correcciones/devoluciones como ventas nuevas. Ticket medio = ingreso neto del periodo / ventas originales del periodo; cero si no hay ventas originales. Unidades netas = vendidas corregidas − devueltas.
- Zona Europe/Madrid. Las horas locales inexistentes al adelantar el reloj se rechazan; en el solapamiento de otoño se usa la primera ocurrencia. La API también admite un instante con zona explícita.

## Integración y experiencia

`calculatePoints` produce los resultados del punto y los del informe general. Se suman una vez a las finanzas históricas de web/manual, conservando los valores desconocidos de esas fuentes. Filtros Todos/Web/Manual de usuarios/Puntos de venta y punto individual, persistidos en URL. Gráfico, indicadores, calendario, ranking y desglose usan los mismos importes. Los costes fijos no se reparten entre productos.

Los indicadores operativos antiguos de Home añaden las ventas externas y sus ingresos netos, conservando el cálculo anterior de pedidos web/manuales (incluido su ámbito operativo distinto del informe financiero). Los últimos pedidos y el mapa siguen siendo vistas de pedidos/clientes, sin fabricar pedidos ni domicilios para ventas externas.

Guardado y stock son una transacción. Las operaciones bloquean la clave de reintento y el punto, y descuentan variantes en orden estable mediante condición `stock >= cantidad`. Una revisión antigua se rechaza. Cada movimiento enlaza el asiento en `StockMovement.note`; AuditLog registra la acción. Repetir el mismo contenido y clave devuelve el recibo original. Reutilizar la clave con otro contenido se rechaza.

La interfaz mantiene el formulario ante error y la clave tras un resultado de red incierto. No permite cambiar el contenido de ese intento hasta reintentar o revisar el historial. Los filtros del punto se conservan en URL y se amplían al registrar un movimiento fuera del intervalo para que el resultado quede visible.

## Verificación reproducible

```powershell
npm run prisma:generate --prefix cronox-backend
npm run build:compiled --prefix cronox-backend
npm test --prefix cronox-backend -- --runInBand --silent point-calculations financial-calculations admin-finance-history admin-finance.dom admin-points.dom manual-purchases historical-cost admin-map admin-dashboard
node cronox-backend/scripts/test-sale-points-db.cjs --serve
# Otra terminal; cerrar el servidor escribiendo stop en la primera:
npx --yes --package @playwright/cli playwright-cli -s=cronox-points open http://127.0.0.1:43121/__review/admin
npx --yes --package @playwright/cli playwright-cli -s=cronox-points run-code --filename tests/admin-review/sale-points.browser.js
```

El script PostgreSQL comprueba la identidad loopback y crea un nombre aleatorio `cronox_points_test_*`, aplica la migración real, carga fixtures sintéticos y elimina exclusivamente esa base al terminar. El servidor de revisión liga a 127.0.0.1, usa secretos de prueba y desactiva correo/trabajos externos. El acceso `/__review/admin` existe exclusivamente en ese script, nunca en la aplicación.

Pruebas: tres ejemplos (150 €, 50 €, 150 €), pérdida sin ventas, productos/tallas/precios/comisiones diferentes, coste posterior a la venta, snapshots inmutables, cuatro reintentos concurrentes, competencia por la última unidad entre puntos, stock insuficiente con rollback, corrección y devoluciones con/sin reposición y recuperación, corrección posterior a devolución, cero/ausente, gastos/anulaciones, fuentes sin duplicación, conciliación de gráfico/indicadores, permisos HTTP y regresiones web/manuales. El navegador recorre formularios en 1440 y 390 px e interrumpe una respuesta después del commit para comprobar el reintento sin duplicado. Capturas en `output/playwright/`; resultados PostgreSQL en `test-results/sale-points/`.

Resultado local: compilación correcta, 151 pruebas Jest aprobadas, integración PostgreSQL aprobada y seis ejemplos de navegador (tres por ancho) aprobados con reintento tras respuesta perdida. La revisión adicional de pérdidas comprobó 320, 390 y 1440 px sin desbordamiento de página. Las bases desechables se eliminaron al terminar.

No se han probado datos reales ni realizado commit, push o despliegue. No hay conversión de divisas ni integración automática con terminales físicos: son registros administrativos en EUR.

## Activación del localhost habitual · 12/10/2026

La migración estaba pendiente en `cronox_dev`, aunque el cliente Prisma generado ya incluía los modelos. El servidor normal (`start-local.cjs --watch`, puerto 3000) y la inspección PostgreSQL confirmaron la conexión aislada `127.0.0.1:5433/cronox_dev`. Faltaban las tres tablas y el endpoint de puntos devolvía HTTP 500; también afectaba al resumen y a finanzas generales.

Se guardó un backup local en `test-results/local-points/before-migration.dump`, se aplicó la única migración pendiente mediante `migrate:local`, se regeneró Prisma, se recompiló y se reinició el servidor con el perfil `.env.local`. Los procesos de revisión anteriores mantenían cargada la DLL de Prisma en Windows: se cerraron y se corrigió la salida del script de revisión tras su limpieza.

URL disponible: **http://localhost:3000/admin.html#section-sale-points**, con el acceso administrativo local habitual. No utiliza `/__review/admin`. Los secretos y credenciales no se muestran en los informes.

Se creó una prenda sintética marcada TEST (coste 15 €, precio de catálogo 70 €, stock inicial 20) para no alterar el stock del catálogo previamente importado. Desde los formularios reales se verificaron dos puntos TEST, en 1440 y 390 px: crear, venta de dos unidades a 25,50 €, comisión 20 %, gasto 5 €, editar lugar, archivar, recargar y consultar Dinero filtrado por punto. Cada punto muestra facturación 51 €, coste 30 €, comisión 10,20 €, gasto 5 € y beneficio 5,80 €, idéntico al indicador y suma del gráfico general. Las operaciones y consultas devolvieron 200/201, sin errores JavaScript; los logs del servidor no contienen excepciones. Los puntos archivados y sus datos permanecen disponibles para revisión local.

Verificación reproducible con sesión local ya iniciada: `tests/admin-review/normal-local-sale-points.browser.js`. Evidencias y logs en `test-results/local-points/`; capturas en `output/playwright/normal-local-points-*.png`. Producción no se ha conectado ni modificado en esta activación; no hay commit, push ni despliegue.

## Botones y reactivación · 12/10/2026

La reproducción en el localhost normal confirmó que los puntos de prueba archivados tenían ambos botones deshabilitados, pero con opacidad 1 y cursor pointer. No había acción de reactivación. En un punto activo se abrían ambos formularios; la API respondía 200. La causa confirmada fue una indicación visual insuficiente del archivado, no un fallo de eventos o permisos.

Ahora la ficha muestra «Punto archivado», una explicación visible enlazada a los botones deshabilitados y la acción «Reactivar». La edición explica que archivar bloquea nuevas ventas/gastos y conserva historial y estadísticas. La reactivación reutiliza la API de edición auditada, la revisión vigente y una clave de reintento estable; actualiza la ficha y habilita los botones sin recargar. Sus errores quedan visibles. Se versionaron JS/CSS para cargar los recursos actualizados.

Se recorrió el ciclo real completo en 1440 y 390 px con datos sintéticos locales: crear, guardar venta/gasto, consultar estadísticas, archivar, comprobar historial y contribución general, reactivar, abrir ambos formularios, guardar otro gasto y recargar. Beneficio inicial 5,80 €, conservado al archivar; después del gasto adicional de 3 €, beneficio 2,80 € en ficha y Dinero. HTTP 200/201, sin errores JavaScript ni excepciones del servidor. Los nuevos puntos TEST quedan activos para revisión. Evidencias: `test-results/local-points/buttons-review.txt` y `output/playwright/normal-local-points-archived-*.png`.

## Beneficio, botón de línea y stock seleccionable

Se sustituye «Contribución» por «Beneficio» en las líneas, el ranking y el desglose de puntos. El cálculo conserva el coste y la comisión y sigue excluyendo los gastos fijos del beneficio por producto. «Quitar línea» deja de estirarse en la rejilla: tamaño observado 92 × 38 px tanto en escritorio como en móvil.

Las ventas y correcciones admiten `stockHandling`: `DEDUCT_NOW` (predeterminado, compatible con registros/solicitudes anteriores) o `ALREADY_ADJUSTED`. En una venta nueva, el primer modo descuenta stock y el segundo registra sin volver a descontar, incluso con stock actual cero. En una corrección se aplica la elección exclusivamente a la diferencia de cantidades. No se altera el precio pagado, el coste congelado ni las comisiones. La elección se conserva en el estado y en el historial inmutable antes/después, y en la auditoría. Las devoluciones mantienen su elección explícita de reposición. No requiere otra migración: el estado financiero ya es JSON.

Verificados en PostgreSQL desechable: stock cero previamente descontado, reintento sin duplicación, beneficio 21 € para dos unidades a 25,50 € con coste 15 €, corrección ya ajustada sin movimiento, corrección con descuento por la diferencia, rollback por falta de stock y devolución con reposición explícita. Compilación y 29 pruebas Jest relacionadas aprobadas.

En el localhost persistente, el navegador probó ambos modos en 1440 y 390 px con productos sintéticos TEST separados. El stock normal bajó 10→8 y después 8→6; el producto ya descontado siguió en cero. Las correcciones marcadas como ya ajustadas conservaron el stock. Los beneficios y la elección persistieron tras recargar. Script: `tests/admin-review/sale-points-stock.browser.js`; evidencia: `test-results/local-points/stock-browser-review.txt`. Sin operaciones en producción, commit, push ni despliegue.

## Sugerencias del filtro de historial

El campo abre una lista de hasta diez productos del punto, ordenados por unidades netas vendidas en el periodo (desempate por facturación e ID). Es el significado de «más calientes» adoptado para esta vista. Se reutilizan los datos financieros ya cargados: escribir no dispara nuevas peticiones. Las coincidencias por nombre ignoran mayúsculas y tildes; también se puede buscar el ID exacto. Los productos sin ventas/movimientos en el periodo no son candidatos.

Elegir una sugerencia aplica inmediatamente `productId` al historial. La selección exacta evita colisiones entre nombres iguales o IDs que son parte de otros. La búsqueda libre sigue disponible con Enter o Aplicar filtro. Se conserva el producto en la URL y al recargar; editar el texto elimina la selección anterior y limpiar/aplicar restaura todo el historial. Flechas/Enter, Escape y clic fuera gestionan el desplegable. El filtro afecta a registros de ventas y sus ajustes, no a las cifras generales ni a los gastos sin producto.

Verificación: pruebas DOM con doce candidatos (límite diez, orden, predicción sin tildes, ratón/teclado y limpieza); prueba del servidor para IDs 1/11 con mismo nombre, búsqueda libre y gastos excluidos sin alterar totales. Navegador real en localhost, 1440/390 px, selección por clic/teclado, ausencia de coincidencias, recarga y limpieza. Script `tests/admin-review/sale-points-history.browser.js`; evidencias en `test-results/local-points/history-browser-review.txt` y `output/playwright/points-history-*.png`.
