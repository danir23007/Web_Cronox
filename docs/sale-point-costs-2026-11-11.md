# Puntos de venta: costes congelados y resultados parciales

Corrección preparada y verificada por separado en `fix/sale-point-costs-20261111`, basada en `origin/main` / `77b268a8aa036d889a7330530f263b870220132c`. Conserva la publicación de Agotado/Avisarme. No añade migraciones. Tras revisar el resultado local, el usuario autorizó su commit y publicación en cronox.es el 11/11/2026. La publicación no aplica automáticamente las propuestas de conciliación histórica.

## Diagnóstico reproducido

El servidor de revisión clona exclusivamente PostgreSQL local. Carga la implementación anterior de Puntos de venta desde ese commit, registra ventas sintéticas por sus servicios reales y conserva un snapshot histórico conocido. Reproduce 410 € de facturación, 205 € de comisión y 9 unidades: dos unidades con coste guardado de 13,75 € cada una y siete con coste pendiente. El control de talla L produce 6,25 € de beneficio; el total calculable es 27,50 € de coste y 12,50 € de beneficio parcial.

Se identificaron cuatro pérdidas de información:

1. Las ventas gestionadas por tiradas leían asignaciones de inventario con componentes nulos procedentes del saldo inicial, sin aplicar el coste predeterminado de la tirada elegida.
2. `ALREADY_ADJUSTED` generaba siempre una parte histórica UNKNOWN, aunque se conociera la tirada. Al corregir una venta también reconstruía esa parte y podía perder su coste ya congelado.
3. La calidad global UNKNOWN de una tirada impedía reconocer componentes completos de una recepción dentro de ella.
4. La agregación convertía coste y beneficio completos a null al encontrar cualquier coste desconocido, descartando la parte calculable. El mapa sumaba los resultados de movimientos por separado, por lo que una anulación podía mantener el resultado desconocido indefinidamente.

Tras la autorización explícita posterior del usuario, se contrastaron únicamente cifras agrupadas mediante una transacción READ ONLY en producción, sin exportar registros individuales ni modificar datos. Coinciden los 410 €, 205 € y 9 unidades: la talla L y una XL conservan costes; las otras siete unidades están pendientes. La calidad de los saldos de sus tiradas es UNKNOWN, sin componentes completos de recepción; ASHEN usa Ya estaba descontado. La marca global ocultaba la parte calculable.

Hay evidencia fechada anterior para tres unidades pendientes, todas a 13,75 €: BLACK L, RED M y RED XL, una de cada. Se pueden proponer 41,25 € adicionales de coste y 18,75 € de beneficio calculable, manteniendo cuatro unidades pendientes (ASHEN S, BLACK S, RED M y RED XL). Son candidatos por evidencia histórica, no valores tomados del coste actual. No se aplicó ninguna conciliación en producción. Las dos consultas inicialmente rechazadas por revisión automática no se ejecutaron; la consulta agrupada posterior sí quedó autorizada y se completó.

## Valoración y conservación

- Descontar stock mantiene el criterio FIFO del inventario y sus asignaciones físicas a la tirada elegida. Nunca cambia a otra tirada si falta stock.
- Los componentes de recepción completos prevalecen. Los costes estimados o parcialmente registrados siguen pendientes.
- Solo para unidades nuevas sin ningún componente de recepción, se permite el predeterminado verificable de la tirada elegida. Para la activa se comprueba su identidad antes de usar la configuración actual proyectada del producto; para una inactiva se usa su propio perfil. El predeterminado incluye transporte: no se añaden otra vez transporte ni gastos de otra recepción.
- En Ya estaba descontado no se reclama ni descuenta inventario. Se admite una recepción de coste uniforme o el predeterminado aplicable a un saldo sin coste. Las recepciones heterogéneas sin salida identificada quedan pendientes, incluso si existe un predeterminado actual.
- Cada parte guarda tirada, cantidad, componentes y procedencia (`RECEIPT`, `EDITION_DEFAULT`, `UNIFORM_EDITION_RECEIPT`, etc.). Se conservan los costes de unidades ya guardadas al corregir; solo las unidades adicionales se valoran de nuevo. Cero explícito es conocido, null es pendiente.
- La reposición de una venta ya descontada conserva también el coste histórico conocido en las unidades que vuelven al inventario. Una tirada explícita nunca consume otra silenciosamente, tampoco si falta una proyección de tirada activa.

## Informes y selector

Punto individual, listado, gráfica, desglose por producto y talla, Finanzas/Dinero, calendario, rankings y mapa conservan `costCents` / `profitCents` en null cuando falta información. Publican además `knownCostCents`, `knownProfitCents`, `knownCostUnits` y `pendingCostUnits`.

El beneficio parcial contiene los movimientos calculables y descuenta los gastos fijos una sola vez; los ingresos/comisiones de las unidades cuyo coste está pendiente no se presentan como beneficio definitivo. Los gastos fijos no se asignan a productos. Las incertidumbres se compensan por identidad de venta y procedencia, de modo que una anulación no invalida permanentemente todo el periodo.

La gráfica deja huecos donde no existe beneficio calculable. Los valores parciales tienen trazo discontinuo y marcadores abiertos, con importe y unidades pendientes en el tooltip. El mapa mantiene desconocidos el color y el porcentaje de un beneficio incompleto; muestra el importe parcial en sus textos. El módulo actual de exportación no ofrece un informe de Puntos de venta/Finanzas: sus módulos de pedidos, productos e inventario no comparten esta agregación y no se han cambiado sus cálculos.

Tirada vendida contiene solamente IDs reales y etiquetas `1 tirada`, `2 tirada`, etc., ordenadas por número. Cada línea nueva selecciona la activa; cambiar otros campos no modifica la elección manual. Cambiar producto/talla carga sus opciones. La edición muestra y conserva la tirada guardada. El servidor valida producto y talla y devuelve un error específico de falta de stock sin modificar el formulario. Caché de los tres JS del administrador incrementada.

## Conciliación histórica

`node cronox-backend/scripts/reconcile-point-costs-local.cjs` previsualiza en una transacción de solo lectura y rechaza hosts externos. Admite `--point=UUID`. No emplea el coste actual del catálogo ni el perfil actual de la tirada para rellenar una venta antigua.

Puede proponer componentes completos ya guardados en la venta o un coste de la tirada documentado en una auditoría anterior a su fecha. Conserva costes correctos. Los casos sin tirada identificada, con evidencia insuficiente, recepciones incompletas, correcciones, cambios de fecha o devoluciones requieren conciliación manual conjunta desde el historial de lotes y su evidencia correspondiente.

La aplicación exige `--apply --actor=ID` de un SUPERADMIN local; registra revisiones financieras y auditorías, sin alterar ingresos, comisiones, unidades ni stock. La repetición conserva las revisiones existentes. Se probó en la copia desechable: una propuesta, una aplicación, una repetición sin cambios, beneficio 6,25 € y stock idéntico. No se aplicó a la base local original. Su previsualización encontró 42 unidades con coste correcto y ninguna pendiente; esto no acredita el estado de las ventas de producción.

## Repetir y revisar

```powershell
node cronox-backend/scripts/review-product-editions-integrated.cjs --point-costs
node cronox-backend/scripts/prepare-point-costs-browser.cjs
# Playwright CLI, sesión independiente y navegador abierto:
playwright-cli --session cronox-point-costs run-code --filename output/playwright/point-costs/browser.cjs
```

Backend real en `http://127.0.0.1:43132`, con autenticación y CSRF reales, copia desechable y correo/pagos simulados; no publica nada. El script genera credenciales sintéticas y IDs en `output/playwright/point-costs/fixture.json`, excluido de Git. La URL concreta de la revisión se obtiene del campo `pointCosts.pointId`:

`http://127.0.0.1:43132/admin.html#section-sale-points?point=ID&from=2026-10-25&to=2026-11-12`

La copia permanece abierta para revisión. Al cerrar mediante el endpoint de revisión `/__review/stop` se desconecta Nest y se elimina exclusivamente esa base desechable. Los controles de revisión solo existen en el script, no en la aplicación desplegable.

Evidencia local excluida de Git: `output/playwright/point-costs/`, `output/point-cost-*.log`. Incluye la reproducción, capturas a 390/1440 px, costes de ambas tiradas en ambos modos, predeterminado/cero/pendiente, conservación histórica, comisión de 27,33 € sobre 82 € al 33,33 %, redondeo de medio céntimo hacia arriba, devoluciones con/sin reposición, anulación de gasto, anulación de una venta con coste pendiente, validación de tirada ajena, error de stock y conciliación entre punto, gráfica, productos, Finanzas y mapa.

Verificación final: 295 suites / 3147 pruebas aprobadas. Typecheck del administrador y backend, compilación Vite/Nest y comprobador de contenido privado aprobados. Regresiones PostgreSQL de Puntos/Mapa y de tiradas aprobadas; ambas bases desechables se eliminaron al terminar. La última copia de revisión visual se mantiene abierta.

Revisión abierta: `http://127.0.0.1:43132/admin.html#section-sale-points?point=212a4cbf-4b06-4999-a9f0-e6aaae068664&from=2026-10-25&to=2026-11-12` (reproducción sintética de 410 €). Casos de ventas, costes distintos, edición y devoluciones: `point=30b70a07-92ab-4f49-8880-5bafeb40f2ea` en el mismo servidor e intervalo. IDs válidos mientras permanezca abierta esta copia; una nueva ejecución genera otros.
