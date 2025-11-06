# Cronox Backend

Backend de la tienda Cronox construido con [NestJS](https://nestjs.com/), Prisma y PostgreSQL.
Incluye autenticación JWT, gestión de productos/carrito/pedidos y un panel administrativo por API.

## Stack principal
- NestJS 11 + TypeScript
- Prisma ORM con PostgreSQL (compatible con Supabase)
- Stripe (payment intent + webhook)
- Class Validator/Transformer para DTOs

## Puesta en marcha
1. Crea un `.env` a partir de `.env.example` con la cadena `DATABASE_URL` de tu instancia.
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Ejecuta las migraciones y genera el cliente de Prisma:
   ```bash
   npm run prisma:migrate
   npm run prisma:gen
   ```
4. Arranca el servidor en modo desarrollo:
   ```bash
   npm run dev
   ```

El servidor escucha en `http://localhost:3000` y expone documentación Swagger en `http://localhost:3000/api/docs`.

## Scripts útiles
- `npm run dev`: alias de `npm run start:dev`.
- `npm run prisma:migrate`: aplica migraciones en local.
- `npm run prisma:deploy`: aplica migraciones en producción.
- `npm run prisma:gen`: regenera el cliente Prisma.
- `npm run lint:fix`: ejecuta ESLint con autofix sobre el código.
- `npm run start:prod`: arranca en modo producción tras compilar (`npm run build`).

## Roles y acceso
Cada usuario tiene un campo `role` (`USER` o `ADMIN`). Por defecto los registros nuevos son `USER`.
Para elevar un usuario a `ADMIN` en un entorno de desarrollo puedes ejecutar directamente en la base de datos:
```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'admin@cronox.dev';
```
También puedes promocionar usuarios desde la API administrativa una vez tengas un token de un admin.

## Panel administrativo (API)
El panel se sirve únicamente como API bajo `/admin/**` y está protegido con JWT + guard de roles.
Consulta ejemplos completos de `curl` en [`src/admin/README.md`](src/admin/README.md).

### Pedidos
- `GET /admin/orders`: listado paginado con filtros por estado, fechas, usuario y total.
- `GET /admin/orders/:id`: detalle con líneas de pedido.
- `PATCH /admin/orders/:id/status`: cambia el estado entre `PENDING`, `PAID`, `CANCELLED`, `REFUNDED` o `SHIPPED`.
- `POST /admin/orders/:id/refund`: marca un pedido como reembolsado (stub para integrar con Stripe).
- `GET /admin/orders/export.csv`: exporta el listado filtrado actual a CSV listo para Excel/Sheets.

### Usuarios
- `GET /admin/users`: búsqueda por email/nombre con paginación y ordenación.
- `GET /admin/users/:id`: devuelve perfil y direcciones asociadas.
- `PATCH /admin/users/:id/role`: cambia entre `USER` y `ADMIN` con protecciones (no deja sin admins ni permite que un admin se degrade a sí mismo).

### Productos y variantes
- CRUD completo de productos y variantes mediante `/admin/products`.
- Ajuste de stock con `PATCH /admin/products/:productId/variants/:variantId/adjust-stock` usando deltas positivos/negativos y motivo opcional.

### Movimientos de stock
- `GET /admin/stock/movements`: historial de ajustes con filtros por producto/variante/fecha/motivo.
Cada ajuste registra `delta`, `reason` y el administrador responsable (`userId`).

## Flujo de trabajo recomendado
1. Crea o promociona un usuario admin.
2. Autentícate y usa los endpoints `/admin/users` para gestionar roles y cuentas.
3. Gestiona catálogo (`/admin/products`) y mantén el stock actualizado con el endpoint de ajustes.
4. Controla pedidos (`/admin/orders`) y descarga CSV para contabilidad (`/admin/orders/export.csv`).
5. Audita cualquier cambio de inventario en `/admin/stock/movements`.

Recuerda mantener sincronizado Prisma tras cambios en el esquema con `npm run prisma:gen` y revisar migraciones en el directorio `prisma/migrations`.
