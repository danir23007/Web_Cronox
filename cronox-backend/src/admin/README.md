# Admin API reference

Todas las peticiones requieren un token JWT de un usuario con rol `ADMIN`.
Sustituye `http://localhost:3000` y `<ADMIN_TOKEN>` por los valores que uses en tu entorno.

## Pedidos

### Listar pedidos con filtros
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/orders?page=1&pageSize=20&status=PAID,SHIPPED&sort=createdAt&order=desc"
```

### Detalle de un pedido
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/orders/42"
```

### Actualizar estado de un pedido
```bash
curl -X PATCH -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status":"SHIPPED"}' \
  "http://localhost:3000/admin/orders/42/status"
```

### Marcar pedido como reembolsado (stub)
```bash
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/orders/42/refund"
```

### Exportar pedidos filtrados a CSV
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -o orders-export.csv \
  "http://localhost:3000/admin/orders/export.csv?dateFrom=2024-01-01&dateTo=2024-12-31&status=PAID"
```

## Usuarios

### Buscar usuarios
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/users?search=gmail&page=1&pageSize=20&sort=createdAt"
```

### Obtener perfil y direcciones
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/users/5"
```

### Cambiar rol de un usuario
```bash
curl -X PATCH -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}' \
  "http://localhost:3000/admin/users/5/role"
```

## Productos y variantes

### Crear producto
```bash
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Camiseta Cronox",
    "slug": "camiseta-cronox",
    "price": 2495,
    "variants": [
      { "size": "M", "sku": "TEE-M", "stockQty": 10 },
      { "size": "L", "sku": "TEE-L", "stockQty": 5 }
    ]
  }' \
  "http://localhost:3000/admin/products"
```

### Actualizar producto
```bash
curl -X PATCH -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Camiseta Cronox Negra"}' \
  "http://localhost:3000/admin/products/12"
```

### Eliminar producto
```bash
curl -X DELETE -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/products/12"
```

### Crear variantes
```bash
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '[
    { "size": "S", "sku": "TEE-S", "stockQty": 3 },
    { "size": "XL", "sku": "TEE-XL", "stockQty": 4 }
  ]' \
  "http://localhost:3000/admin/products/12/variants"
```

### Actualizar una variante
```bash
curl -X PATCH -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"price": 2695, "isActive": true}' \
  "http://localhost:3000/admin/products/12/variants/33"
```

### Ajustar stock de una variante
```bash
curl -X PATCH -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"delta": 5, "reason": "restock"}' \
  "http://localhost:3000/admin/products/12/variants/33/adjust-stock"
```

### Eliminar variante
```bash
curl -X DELETE -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/products/12/variants/33"
```

## Movimientos de stock

### Consultar historial de stock
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "http://localhost:3000/admin/stock/movements?page=1&pageSize=25&productId=12&reason=manual"
```

## Compras presenciales (SUPERADMIN)

`POST /api/admin/users/:id/in-person-purchases` requiere `Idempotency-Key` y la identidad estable del cliente.
Cada elemento de `items` admite `variantId`, `quantity` (1-100) y `unitPriceCents`: un entero no negativo en céntimos, por unidad y con IVA incluido. Por ejemplo, `unitPriceCents: 2550` y `quantity: 2` guardan 51,00 EUR. El total se calcula en el servidor; no se admite un total del navegador.

La omisión de `unitPriceCents` conserva el precio de catálogo para clientes API antiguos. El 0 explícito es gratuito; `null`, cadenas, fracciones y negativos se rechazan. Los importes de línea y pedido no pueden superar el límite de `Decimal(12,2)` (999999999999 céntimos).
Se conservan las líneas de variantes repetidas y sus precios independientes, mientras el stock se comprueba y descuenta por la cantidad conjunta.
El precio forma parte del hash de idempotencia. Un reintento conserva el pedido; cambiar el precio requiere una nueva clave.
Las opciones `DEDUCT_NOW` y `ALREADY_ADJUSTED` y la anulación existente mantienen su tratamiento de stock. El catálogo y el checkout online no se modifican.

Verificación local de interfaz, sin API ni base de datos: `npx playwright test --config playwright.manual-purchases.config.cjs`.

Integración PostgreSQL real: `npm run test:manual-purchases:db --prefix cronox-backend`.
Requiere PostgreSQL local iniciado y `.env.local` seguro, con permisos para crear bases y la extensión `pg_trgm`.
El script crea una base vacía `cronox_manual_test_<UUID>`, materializa el esquema Prisma actual, ejecuta los servicios reales y elimina esa base en `finally`. No importa datos ni escribe en `cronox_dev`. El resultado saneado queda en `test-results/manual-purchases-db/results.json`.
