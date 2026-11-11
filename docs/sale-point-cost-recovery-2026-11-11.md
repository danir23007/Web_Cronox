# Recuperación de costes físicos por evidencia histórica

La corrección amplía la conciliación local existente y conserva el ledger original mediante InventoryPointCostRevision. Esta publicación incluye el código y las pruebas; no ejecuta reparaciones históricas en producción.

## Evidencia y valoración

- Los costes congelados conocidos no se sustituyen.
- Se recuperan componentes completos guardados, asignaciones de salida vinculadas, recepciones identificadas y recepciones de coste uniforme.
- La configuración de la tirada documentada en una auditoría anterior a la venta prevalece sobre la configuración actual.
- Si no existe auditoría anterior, se admite el coste configurado de la tirada original únicamente con historial coherente y sin contradicción con el coste guardado.
- Si falta el ID de tirada, se busca una salida vinculada o una única tirada aplicable en la fecha de venta. Un saldo inicial migrado representa existencias anteriores, no una recepción nueva en la fecha de migración.
- Cero es un coste conocido; vacío es desconocido. Recepciones incompletas, costes contradictorios y varias tiradas plausibles permanecen pendientes con su motivo.
- Las ventas antiguas con correcciones, devoluciones o cambios de fecha se identifican para conciliación coordinada; no se modifica solo una parte de su historial.

La previsualización devuelve por línea venta, fecha, producto, talla, cantidad, tiradas, coste anterior y propuesto, origen y evidencias. profitImpactCents expresa el cambio en el beneficio parcial calculable. Recuperar un coste también incorpora los ingresos y comisiones de las unidades que antes estaban excluidas del beneficio parcial.

La aplicación guarda una revisión financiera y actualiza el coste y la procedencia de la venta. No modifica precios pagados, comisiones, forma de pago, cantidades, cobros, gastos ni stock. Una segunda ejecución no vuelve a aplicar la revisión.

## Comandos locales

Desde la raíz, con el nombre de la base desechable y el actor sintético que figuran en el fixture de revisión:

```powershell
# Previsualización READ ONLY; sustituir ID por los 32 caracteres de la copia.
node cronox-backend/scripts/reconcile-point-costs-local.cjs --review-db=cronox_editions_ui_ID --point=UUID_DEL_PUNTO
# Aplicación exclusivamente local.
node cronox-backend/scripts/reconcile-point-costs-local.cjs --review-db=cronox_editions_ui_ID --point=UUID_DEL_PUNTO --apply --actor=ID_SUPERADMIN_LOCAL
```

El CLI rechaza hosts externos. --review-db solo acepta el patrón de las bases desechables y conserva la conexión loopback de .env.local. La aplicación exige un SUPERADMIN de esa copia.

## Verificación y privacidad

Se reprodujo el informe real en una copia aislada y se contrastaron costes recuperados, estados de venta, indicadores, gráfica, productos, tallas, Finanzas y Mapa. Se comprobó la idempotencia y la conservación de los datos ajenos al coste. El informe de ventas, IDs reales, importes empresariales y extracto permanecen en evidencia local excluida de Git; no forman parte de esta publicación.

La regresión PostgreSQL del repositorio añade casos sintéticos de tirada única, tirada guardada, coste cero, recepción uniforme, campo vacío, tiradas ambiguas, historial contradictorio, snapshots conservados y repetición sin cambios. El fixture de navegador comprueba las ventas nuevas en ambas tiradas y modos de stock, correcciones, activación de otra tirada, devoluciones y reposición sin perder el coste original.

```powershell
node cronox-backend/scripts/test-sale-points-db.cjs
node cronox-backend/scripts/review-product-editions-integrated.cjs --point-costs
node cronox-backend/scripts/prepare-point-costs-browser.cjs
```

El backend de revisión usa PostgreSQL local desechable, autenticación y CSRF reales y correo/pagos simulados. Su cierre elimina exclusivamente esa copia. No se añaden migraciones ni rutas de reparación productiva.
