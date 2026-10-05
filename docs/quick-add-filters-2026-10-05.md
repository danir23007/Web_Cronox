# Quick Add y orden de filtros — revisión local 2026-10-05

Estas son correcciones **posteriores** al commit `2d84409464da6cdc01fd428ad2cb1d2a1b6998ff`.
No se ha creado otro commit, hecho push ni desplegado. No se toca producción,
inventario, pedidos ni la base local. El trabajo anterior de SEO, categorías,
seguridad, email y exportaciones se conserva.

## Causa y corrección de las fotos

Quick Add está implementado en `cronox-front/assets/products.js`. Abre con el
producto ya adaptado del catálogo: no hace una petición de producto al pulsar +.
El modal reutilizaba `qaImg1` y `qaImg2`, cambiando sus URLs mediante
`responsive-images.js`. El navegador puede mantener la imagen previamente
decodificada mientras solicita/decodifica la siguiente. Además, comprobar
`if (!qaImg.src)` no constituye una limpieza: una URL anterior sigue siendo
truthy. El primer elemento conservaba handlers de fallback y el segundo recibía
solo `apply`, sin sustituir ese estado.

Cada apertura ahora sustituye inmediatamente los dos nodos de imagen por nodos
nuevos, conservando la galería y sus dimensiones. Permanecen transparentes
mientras cargan, con fondo negro ligeramente matizado y `aria-busy`; después
se muestran al recibir su propia imagen. Los presets optimizados y sus fallbacks
pertenecen al producto seleccionado, o al placeholder neutral si no tiene fotos.
La carga es eager dentro del modal; no se precarga el catálogo ni se añade una
espera artificial. Si una imagen falla también en su fallback, permanece oculta
y se termina el estado ocupado, sin recuperar una imagen del producto anterior.

Un contador por apertura invalida los eventos anteriores, también al cerrar,
y evita que una respuesta antigua de añadir al carrito cambie la interfaz de
una reapertura del mismo objeto de producto. Cerrar retira las imágenes del DOM.
Nombre, precio, tallas, stock y acción se siguen configurando conjuntamente
desde el producto seleccionado. No se modifica el carrusel de las tarjetas ni
las reglas de elección de talla, stock y carrito.

## Orden y clasificación

La lista dinámica en `assets/app.js` filtra primero `isActive` y
`showInStoreFilters`, y ordena por `Category.group`:

1. `NEW`, reservado por la API para NOVEDADES, incluso si se cambia su nombre.
2. `DROP`, para drops/colecciones, alfabéticamente.
3. `GARMENT`, para prendas/tipos, alfabéticamente.

Se usa `Intl.Collator('es', { sensitivity: 'base', usage: 'sort' })`: ignora
diferencias de mayúsculas y compara adecuadamente el alfabeto español.
No se deduce el grupo por nombre, prefijo, slug ni listas fijas.
Las categorías sin grupo reconocido o `UNCLASSIFIED` se conservan **al final**,
ordenadas alfabéticamente; requieren clasificación explícita desde administración.
No se les inventa grupo ni se ocultan. En la respuesta actual de localhost:3000,
las seis categorías públicas sí tienen clasificación: un NEW, un DROP y cuatro
GARMENT. No se modificaron sus registros.

Orden comprobado: NOVEDADES, D#01, CAMISETAS, CHAQUETAS, COMPLEMENTOS, PANTALONES.
Una categoría oculta queda fuera también si es NEW. Se conservan las filas label,
inputs accesiblemente ocultos, selección múltiple, foco y estado seleccionado;
no se añaden encabezados/separadores ni espacio de casillas.

## Archivos y comprobaciones

Implementación: `assets/products.js`, `assets/app.js`, `assets/quick-add.css`.
Referencias HTML de esos assets: versiones 66, 83 y 7 respectivamente para
evitar cachés antiguas en tienda y en las otras páginas que comparten los scripts.
Pruebas: nuevo `quick-add-category-regression.dom.spec.ts`, función reproducible
`tests/admin-review/quick-add-filters.browser.js` y ajustes de tres tests de
referencias/versiones de imágenes y CSS.

- **73 suites / 671 pruebas frontend correctas**, incluidas las nuevas.
- Los tests ejecutan los scripts reales en JSDOM: cargas tardías A→B, cierre y
  reapertura, fallback antiguo, callback de carrito anterior, variante emitida
  del producto vigente, talla sin stock, imagen ausente, orden dinámico español,
  nombre NEW renombrado, NEW oculto, categoría nueva y selección conservada.
- Navegador en **localhost:3000**, escritorio 1366 y móvil 390: catálogo real
  de siete productos; orden real de seis filtros; selección/deselección por
  fila y teclado. Quick Add se abre desde los botones + reales; imágenes retenidas
  sin caché HTTP, entregas en orden inverso, cambios de producto y cierre/reapertura.
  Nunca conserva nodos/fuentes del anterior, mantiene el espacio y no presenta
  errores JavaScript. Una imagen ya decodificada del mismo producto puede aparecer
  inmediatamente al reabrirlo: es un acierto de caché válido.
- En esa prueba se entregan imágenes SVG neutras únicamente para controlar el
  orden de las respuestas; **no se simula el catálogo**. Cero escrituras de carrito.
  Las reglas de añadir al carrito se prueban mediante eventos/transportes simulados,
  sin alterar stock, pedidos o pagos reales.
- `npm run admin:build` y `npm --prefix cronox-backend run build:compiled` correctos.
  No se necesita migración, instalación de paquetes ni regeneración Prisma:
  no cambia el esquema ni código backend. `git diff --check` correcto.
- El propietario del puerto se comprobó antes de reiniciar: únicamente el
  backend local de este repositorio. Queda ejecutándose el build actual mediante
  `start:local` (base local protegida, correo y trabajos desactivados).

Reproducción (desde la raíz, con localhost:3000 operativo):

```powershell
npm --prefix cronox-backend test -- --runInBand frontend
npx --yes --package @playwright/cli playwright-cli -s=quick-filters open http://localhost:3000/tienda
npx --yes --package @playwright/cli playwright-cli -s=quick-filters run-code --filename tests/admin-review/quick-add-filters.browser.js
```

Logs y capturas revisadas en `output/playwright/quick-add-filters-2026-10-05/`,
ignorados por Git. Cambios sin stage ni commit, preparados para revisión local.

## Continuaci?n autorizada: calendario y publicaci?n

Este informe conserva las verificaciones de la etapa anterior. El encargo posterior
autoriza reunir estas correcciones y publicarlas, y sustituye la base de tres d?as
naturales por esa base m?s los incrementos de fines de semana y festivos oficiales.
Regla vigente, fuentes, l?mites y preparaci?n: [calendario compartido](delivery-calendar-2026-10-05.md).
