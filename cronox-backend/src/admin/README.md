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
