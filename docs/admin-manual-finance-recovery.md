# Beneficio de compras manuales y recuperación histórica

## Causa y corrección

El formulario envía siempre `purchasedAt`. El servicio interpretaba la presencia de esa fecha como ausencia de evidencia histórica y guardaba siempre `unitCostCents: null`. Los pedidos sí entraban en facturación: el cálculo compartido los incluía, pero no podía obtener un beneficio completo sin costes.

Solo para compras manuales, ahora se congela el coste privado configurado `ProductCost` al registrar la compra, aunque su actualización sea posterior a `purchasedAt`. Esta excepción está autorizada por la regla de negocio y no se aplica a pedidos web. Un coste explícito de cero es válido; solo un coste realmente ausente o inválido queda desconocido. La auditoría conserva valor y fecha de la fuente. Cambiar después el catálogo o su coste no modifica el beneficio guardado.

La fuente del ingreso es exactamente el campo **Precio pagado por unidad (€)** de Administrador → Usuarios → Pedidos → Nueva compra. Se guarda como `unitPrice`/`lineTotal`; el precio del catálogo no se sustituye al calcular resultados. Una compra nueva sin precio pagado explícito se rechaza, en lugar de utilizar el catálogo. Se conserva la posibilidad de reproducir solicitudes antiguas ya guardadas mediante su clave de idempotencia. Los pedidos web mantienen su cálculo existente basado en sus importes, descuentos, pago y devoluciones.

La facturación procede de los importes realmente guardados en las líneas, con los descuentos del pedido distribuidos mediante la regla existente. El envío queda excluido. Se mantienen IVA incluido y las reglas existentes sobre otros gastos: el indicador no deduce gastos no registrados. Las ventas manuales usan `purchasedAt`; las web, la fecha de cobro; reembolsos y reposiciones se contabilizan en sus propias fechas. El panel sigue usando `Europe/Madrid`. Los timestamps UTC sin sufijo del JSON de PostgreSQL ahora se interpretan como UTC también al ejecutar el servidor en otra zona horaria.

Un reembolso monetario no devuelve por sí solo el coste. Se devuelve el coste de las unidades cuya reposición esté documentada. Anular una venta con stock ya ajustado y sin movimiento de reposición mantiene ese coste, según la regla anterior. Si una devolución parcial con varios artículos o envío no permite atribuir importes de forma fiable, se conserva el estado desconocido. Ningún total incompleto se muestra como beneficio completo. Los avisos de coste desconocido identifican línea y producto; el informe de revisión añade el pedido correspondiente.

## Compras existentes examinadas

Inspección previa de la fuente configurada realizada el 11 de octubre de 2026, mediante una transacción explícitamente de solo lectura. Después, con autorización expresa para publicar y recuperar, se aplicó la recuperación descrita en [el resultado de producción](admin-manual-finance-production-release.md).

| Pedido | Líneas | Productos | Fecha de compra |
| --- | --- | --- | --- |
| 19 | 24, 25, 26, 27, 28, 29, 30 | 2, 1, 5, 3, 4, 10001, 10002 | 23/09/2026 |
| 20 | 31 | 10002 | 23/09/2026 |

Antes de recuperar, las ocho líneas (nueve unidades) tenían coste desconocido en `FinanceArchive`, `OrderItemFinancial` y las revisiones guardadas. Todas tenían coste configurado en `ProductCost`, actualizado el **07/10/2026**. Según la regla manual autorizada, se recuperaron las ocho usando esos valores, aunque las compras fueran del 23/09. **No falta ningún coste.** La línea con precio pagado cero conserva su coste y produce una pérdida, como corresponde.

Informe privado por línea, con fechas, revisión esperada y procedencia de cada valor: `test-results/manual-finance/source-review.json` (ignorado por Git). La base local no contiene estas compras. El informe no contiene datos personales de compradores ni credenciales.

Plan privado revisado: `test-results/manual-finance/configured-cost-plan-19-20.json`. SQL original de referencia: `test-results/manual-finance/recovery-19-20.sql`. Desglose legible: `test-results/manual-finance/recovery-19-20.md`. La ejecución autorizada usó el mismo generador dentro de una transacción externa, con verificaciones previas y posteriores antes de confirmar. Los archivos incluyen procedencia, fecha de inspección y revisión esperada. **No repetir este plan: #19 y #20 ya están recuperados y su revisión ahora es 2.**

Resultado confirmado en producción: pedido #19, facturación de productos **215,00 €**, costes **100,25 €**, beneficio **114,75 €**; pedido #20, facturación **25,00 €**, costes **10,60 €**, beneficio **14,40 €**. Ambos siguen pagados. La copia previa está en `test-results/manual-finance/production-before-2026-10-11T20-34-53-200Z.json`; el recibo de ejecución, en `production-recovery-receipt.json` de esa misma carpeta privada.

## Procedimiento revisable, sin ejecución automática

Este procedimiento sigue disponible para preparar planes nuevos. Los comandos de #19 y #20 son referencias de la preparación original; no se deben volver a aplicar. Un informe nuevo muestra las ocho líneas como `preserve`.

1. Obtener un informe fresco. El comando local usa exclusivamente la configuración local validada; la variante de fuente se limita al host configurado y ejecuta la inspección en solo lectura:

   ```powershell
   node cronox-backend/scripts/review-manual-finance-costs.cjs test-results/manual-finance/review.json
   node cronox-backend/scripts/review-manual-finance-costs.cjs --source-env cronox-backend/.env test-results/manual-finance/source-review.json
   ```

2. Para cada línea manual, conservar primero un coste válido ya guardado, incluido cero. El revisor consulta el archivo actual, la línea operativa y las revisiones anteriores. Si divergen, señala el conflicto. Si no existe coste guardado, propone `ProductCost` sin exigir antigüedad. Rechaza el uso de esta regla para pedidos web. Distingue `missing_cost` (realmente ausente/ inválido) de conflictos entre costes guardados.

3. Para #19 y #20 ya está completado el plan con los costes configurados autorizados, sus fuentes y fechas. Para otras recuperaciones manuales se puede copiar `docs/admin-manual-finance-evidence.example.json`, completar `unitCostCents` en céntimos y `source` con la procedencia del coste (fuente guardada o coste configurado), y marcar `approved: true` tras revisar los valores. Si falta realmente algún coste, no inventarlo: el total seguirá desconocido hasta completarlo. Nunca sobrescribir un coste válido ya guardado.

4. Generar SQL para revisión usando el ID verificado del administrador responsable:

   ```powershell
   node cronox-backend/scripts/prepare-manual-finance-recovery.cjs test-results/manual-finance/source-review.json test-results/manual-finance/configured-cost-plan-19-20.json SESSION_ADMIN test-results/manual-finance/recovery-19-20.sql
   ```

   Este comando **no se conecta a ninguna base ni ejecuta SQL**. Rechaza costes ausentes, aprobaciones pendientes, duplicados y líneas que ya tienen coste. `SESSION_ADMIN` evita inventar un administrador: el SQL exige que, antes de una futura ejecución autorizada, se configure en esa misma sesión `SET cronox.recovery_actor_id = 'ID_VERIFICADO';`. Verifica que ese usuario sea ADMIN/SUPERADMIN. También acepta un ID numérico verificado al generar. Sin administrador válido, la transacción falla sin recuperar datos.

5. El SQL está preparado para una transacción serializable: verifica administrador, pedido manual, producto/línea y revisión esperada; rechaza costes conocidos o conflictos; añade una revisión financiera y auditoría; completa solo el coste operativo desconocido cuando la línea todavía existe. Conserva precios, fechas, cantidades, estados, stock y todas las revisiones anteriores. No se puede repetir un plan antiguo tras una recuperación. Si se rechaza, hacer rollback y revisar un informe nuevo; nunca forzar el cambio ni editar costes históricos existentes.

6. Antes de una futura aplicación autorizada, ensayar el plan sobre una copia aislada y guardar la revisión previa. Después, volver a inspeccionar y comparar indicador, gráfico y desglose del periodo original y de sus devoluciones. Mantener informes, evidencias y SQL privados: contienen costes internos.

## Comprobaciones locales

```powershell
npm test --prefix cronox-backend -- --runInBand --silent admin/finance admin/manual-purchases admin/map admin-finance.dom
node --test cronox-backend/scripts/manual-finance-recovery.test.cjs
node cronox-backend/scripts/test-manual-purchases-db.cjs
npm run build:compiled --prefix cronox-backend
```

La integración crea y elimina una base PostgreSQL desechable en loopback, con datos simulados y los triggers reales del archivo financiero. Cubre una compra anterior a la actualización del coste de 2 × 25,50 € con coste configurado de 15 € (51 € / 21 €), precio de catálogo diferente, cambios posteriores, mezcla web/manual, recarga y ensayo de recuperación auditada sin tocar la base de desarrollo ni la fuente. Verifica también que el SQL preparado rechace un administrador ausente y planes repetidos. Los tests del cálculo cubren varios productos, descuentos, envío, coste cero/desconocido, cancelación y devolución parcial. El test DOM ejecuta el JavaScript real del administrador y compara indicador, trazado/tooltip y tabla tras recargar. Las pruebas de mapa comprueban el mismo cálculo compartido; no se consulta el coste actual al visualizarlo.
