# Orders Module

Este módulo gestiona el checkout y los pedidos confirmados por el proveedor de pagos.

## Variables de entorno

- `VAT_DEFAULT` *(por defecto `0.21`)* → Tipo impositivo de IVA aplicado en el cálculo de totales.
- `SHIPPING_FLAT` *(por defecto `0`)* → Coste de envío plano añadido al total.
- `PAYMENT_PROVIDER` *(por defecto `none`)* → Permite adaptar la respuesta del checkout a un proveedor (`stripe`, `redsys`, etc.).

## Ejemplos de uso

### Preparar checkout

```http
POST /checkout/session
Authorization: Bearer <token>
Content-Type: application/json

{
  "shippingMethod": "standard",
  "shippingAddress": {
    "name": "Ada Lovelace",
    "city": "Madrid",
    "zip": "28001"
  }
}
```

**Respuesta**

```json
{
  "provider": "none",
  "summary": {
    "currency": "EUR",
    "subtotal": "100.00",
    "taxRate": "0.2100",
    "taxAmount": "21.00",
    "shippingCost": "0.00",
    "total": "121.00"
  },
  "lineItems": [
    {
      "productId": 1,
      "title": "Camiseta (M)",
      "quantity": 1,
      "unitPrice": "100.00",
      "lineTotal": "100.00"
    }
  ],
  "metadata": {
    "cartId": 10,
    "userId": 3
  }
}
```

### Confirmar pedido desde webhook

```http
POST /orders
Content-Type: application/json

{
  "provider": "stripe",
  "providerRef": "pi_123456789",
  "amount": "121.00",
  "currency": "EUR",
  "metadata": {
    "userId": 3,
    "cartId": 10
  }
}
```

La llamada es idempotente por `providerRef`. Si el pago coincide con el total calculado, el pedido se crea con estado `PAID` y se vacía el carrito.

## Probar el webhook en local

1. Arranca la API (`npm run start:dev`).
2. Expone tu servidor local con una herramienta como `ngrok`: `ngrok http 3001`.
3. Configura el proveedor de pago (o un simulador) para enviar el webhook a `https://<ngrok>/orders`.
4. Usa el payload del ejemplo anterior para verificar que se crea un pedido y que las respuestas devuelven los importes serializados como texto.
