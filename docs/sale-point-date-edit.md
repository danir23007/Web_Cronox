# Cambiar la fecha de una venta de un punto

Cada venta tiene una acción «Editar fecha», independiente de «Corregir».
El formulario de corrección utiliza la fecha del ajuste, no la fecha original
de venta; por eso conserva las validaciones que impiden retroceder un ajuste.

La acción nueva usa la zona Europe/Madrid, requiere motivo y revisión actual,
y conserva los permisos administrativos existentes. No modifica cantidades,
precios, costes congelados, comisiones, pagos ni stock. Cambia `PointSale.soldAt`
y registra dos asientos compensados en el historial inmutable: retirada de la
imputación en la fecha anterior e imputación en la fecha nueva. Las unidades y
el contador de ventas se trasladan junto a ingresos/costes/comisiones. Los
informes individuales, generales y gráficos usan el mismo cálculo.

Las correcciones y devoluciones mantienen sus propias fechas. Una venta no
puede desplazarse después de una corrección o devolución real ya registrada.
Los asientos de traslado no se consideran nuevas correcciones de prendas al
validar movimientos posteriores. Los reintentos con la misma clave no duplican
asientos; todo se guarda en una transacción y se audita con actor y fechas
anterior/nueva. No se necesita una migración.

Verificación local: pruebas de cálculo/servicio/DOM y finanzas; navegador real
en 1440 y 390 px. Dos unidades a 25,50 €, coste 15 €, sin comisión: ingresos
51 € y beneficio 21 €. Dos cambios de fecha, recarga y reconciliación por día
con finanzas generales y gráfico; una única venta y cero importes en la fecha
anterior. También se guardó una devolución parcial con fecha posterior a la
venta corregida pero anterior a su fecha original; se rechazó adelantar la
venta más allá de esa devolución. Los datos de prueba son exclusivamente locales.
