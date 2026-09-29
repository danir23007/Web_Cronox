# Revisión responsive local — 27/09/2026

Revisión local realizada sobre `dbe705419e009c9df903c0a3e8b17fd1e8ff6c89`, antes de publicar esta actualización. Se utilizó la aplicación normal de `localhost:3000`, con PostgreSQL aislado en `127.0.0.1:5433/cronox_dev` y las protecciones de `start-local.cjs`. Durante estas pruebas no se consultó ni modificó producción, no se importaron datos ni se ejecutaron migraciones. No se realizaron pagos, reembolsos, envíos, correos ni subidas. Las pruebas permiten autenticación local, bloquean escrituras de negocio y simulan únicamente la inicialización automática de carpetas de correo para evitar esa escritura.

## Problemas encontrados y correcciones

| Problema observado | Corrección |
| --- | --- |
| La navegación de cuenta requería desplazamiento lateral a 320 px. | Cuadrícula de dos columnas en móvil; etiquetas completas, objetivos de 44 px y cierre de sesión separado en rojo. En pantallas mayores se permite envolver la fila. Solo permanece visible la sección elegida. |
| Los mínimos de 320/200 px del formulario de cuenta recortaban sus campos. | Columnas fluidas limitadas al ancho disponible y estilos acotados a Mi cuenta. |
| El menú móvil no restauraba correctamente desplazamiento/foco al cerrar o cambiar de tamaño. | Botón de cierre, fondo inerte, ciclo de foco, Escape, cierre desde el fondo y restauración al cruzar el breakpoint. |
| Calendario demasiado estrecho en teléfono, acciones inaccesibles en alturas pequeñas y solapamiento con el lateral a 900 px. | Presets encima del calendario en móvil, altura dinámica con scroll propio y posición corregida en tablet. Foco conservado al cambiar mes/preset, selección de días por teclado y cierre al abandonar el control. |
| Nombres/importes largos ensanchaban las tarjetas financieras. | Columnas `minmax(0,1fr)`, texto adaptable y controles que envuelven. Gráfico al ancho real, espacio para importes completos y consulta de valores por toque/teclado. No cambia el cálculo de ningún importe. |
| Una etiqueta oculta del inventario escapaba de la tabla, ampliando la página a 637 px en un viewport de 320 px. | Contenedor de tabla posicionado. Las tablas que lo necesitan tienen scroll propio, foco y aviso de desplazamiento; no se oculta el desbordamiento global. |
| Formularios, editor de correo y fichas de inventario quedaban demasiado estrechos en tamaños intermedios. | Rejillas fluidas y breakpoints teniendo en cuenta el espacio del lateral. |
| Chips de productos seleccionados de Galería quedaban recortados. | Etiquetas multilínea y salto de fila. |
| Diálogos largos y su foco necesitaban soporte en pantallas bajas. | Altura `dvh`, scroll interno, acciones que envuelven y ciclo/restauración de foco usando las acciones de cancelar existentes. |
| Pantalla Clave desbordaba a 200 % de texto. | Interruptor que envuelve, campos sin mínimos intrínsecos y fieldsets en una columna en móvil. |

Se mantienen las clases de stock (0 agotado, 1–4 poco stock, ≥5 disponible), miniaturas proporcionales, separación de temas público/admin, datos privados, permisos y lógica comercial. No se ha modificado el libro ni su QR.

## Archivos

- `cronox-front/assets/store.css`: navegación y rejillas de Mi cuenta.
- `cronox-front/assets/admin-shell.css`: rejillas, calendario, menús, tablas, diálogos y controles responsive del admin.
- `cronox-front/assets/admin-shell.js`: foco, cierre y restauración del drawer/diálogos.
- `cronox-front/assets/admin-theme.js`: detectar tablas desbordadas y hacer sus contenedores accesibles, reutilizando observadores.
- `cronox-front/assets/admin-finance.js`: dimensiones del gráfico, consulta táctil y foco del calendario; sin cambios financieros.
- `tests/responsive/local-review.cjs`: matriz del admin y cuenta, temas, login, menú, calendario, categorías, productos, códigos, inventario y correo.
- `tests/responsive/expanded-review.cjs`: respuestas de prueba en memoria para listas financieras pobladas, importes/nombres largos, costes desconocidos, pedidos y estados de carga/error/reintento; editores de multimedia.
- `tests/responsive/additional-states.cjs`: filtros expandidos, ficha de usuario, borrador de compra presencial, zoom de texto y foco modal.
- `tests/responsive/public-review.cjs`: portada/producto/checkout vacío reales y capturas de cuenta sin aviso de cookies.
- Este documento. Las capturas y resultados permanecen en `test-results/responsive/`, ya ignorado por Git.

## Verificación

- **558 comprobaciones** en la matriz principal: las 21 secciones actuales a 320, 360, 390, 430, 600, 768, 900, 1024, 1280 y 1440 px, ambos temas; cuenta, formularios, menú y calendario también en WebKit.
- **138 comprobaciones focalizadas repetidas** después de los últimos ajustes del calendario, en Chromium y WebKit, incluyendo toque del gráfico, selección de día con flechas/Enter, foco en presets/mes y Escape.
- **68 comprobaciones** con datos poblados de prueba y editores: Resumen, Dinero, búsqueda/orden/paginación, errores/reintento, detalle de pedido, Tienda, Mosaico y Carrusel. Los datos ficticios se inyectan solo en respuestas del navegador, nunca en la base de datos.
- **150 comprobaciones** adicionales: filtros de Productos/Categorías/Waitlist/Usuarios/Actividad/Círculos, Pantalla Clave, Newsletter, Footer, las seis pestañas de usuario, edición y borrador de compra presencial (sin guardar); texto ampliado al 200 % y ciclo de foco del diálogo.
- **9 comprobaciones** de portada, ficha real de producto y checkout vacío a 320/768/1440. Login real local y recarga de sesión correctos. Opciones de cuenta, selección única y logout correctos; tema público independiente.
- Alturas de 320/400/568 px, paisaje 740×320 y 740×360, tamaños intermedios y cambio de breakpoint con menú abierto. Formularios de creación/edición incluyen categorías, coste, imágenes, variantes y acciones alcanzables, cancelando sin guardar.
- **29/29** pruebas Chromium de carrito, **20/20** de favoritos (Chromium/WebKit), **5/5** de acreditación/QR (Chromium/WebKit).
- **Jest: 627 correctas, 7 fallos, 65 suites.** Los siete nombres coinciden exactamente con los reproducidos sobre HEAD limpio (62 correctas/7 fallos en las seis suites afectadas). Son expectativas previas sobre versiones de assets, fixture de Galería, fallback de imagen, flecha de recomendaciones y consentimiento de cookies en `admin-launch.html`. No se reparan dentro de este alcance.
- Repetición final focalizada tras los ajustes del calendario: **86/86 correctas**, en cinco suites de responsive, mejoras del admin, stock y acreditación.
- `npm run admin:build`, `npm run build:compiled --prefix cronox-backend`, TypeScript del admin, sintaxis de JS y `git diff --check`: correctos.
- SHA-256 de la migración sin cambios: `0c6a05b46c856726f882096542b10377c10d85a021e5bc986a0ae3d2ee0b8a5d`. `.git/info/exclude` y los 17 archivos excluidos conservan exactamente sus hashes al terminar la revisión local.

Los JSON de evidencia están en `test-results/responsive/`: `review.json`, `final-focus/review.json`, `expanded-review.json`, `additional-states.json`, `public-review.json`, `jest-current.json` y `preservation.json`.

## Capturas

| Vista | Móvil 320 px | Tablet 768 px | Escritorio 1440 px |
| --- | --- | --- | --- |
| Mi cuenta | [Móvil](../test-results/responsive/account-clean-account-320.png) | [Tablet](../test-results/responsive/account-clean-account-768.png) | [Escritorio](../test-results/responsive/account-clean-account-1440.png) |
| Acreditación | [Libro y QR](../test-results/responsive/accreditation-loaded.png) | [Tablet](../test-results/responsive/account-clean-accreditation-768.png) | [Escritorio](../test-results/responsive/account-clean-accreditation-1440.png) |
| Admin claro | [Resumen](../test-results/responsive/chromium-light-section-dashboard-320.png) | [Resumen](../test-results/responsive/chromium-light-section-dashboard-768.png) | [Resumen](../test-results/responsive/chromium-light-section-dashboard-1440.png) |
| Admin oscuro | [Resumen](../test-results/responsive/chromium-dark-section-dashboard-320.png) | [Resumen](../test-results/responsive/chromium-dark-section-dashboard-768.png) | [Resumen](../test-results/responsive/chromium-dark-section-dashboard-1440.png) |
| Datos poblados de prueba | [Oscuro](../test-results/responsive/populated-dark-dashboard-320.png) | [Claro](../test-results/responsive/populated-light-dashboard-768.png) | [Oscuro](../test-results/responsive/populated-dark-dashboard-1440.png) |

## Revisión local y límites

Desde la raíz del repositorio, con el puerto 3000 libre:

```powershell
npm run start:local --prefix cronox-backend
```

El proceso local ya queda iniciado. No ejecutar una segunda instancia simultánea. Si necesitas recompilar antes de otro arranque: `npm run admin:build` y `npm run build:compiled --prefix cronox-backend`.

- Cuenta: http://localhost:3000/profile.html
- Admin: http://localhost:3000/admin.html
- Resumen: http://localhost:3000/admin.html#section-dashboard
- Dinero: http://localhost:3000/admin.html#section-money
- Pedidos: http://localhost:3000/admin.html#section-orders
- Tienda: http://localhost:3000/

Repetir la auditoría con el servidor local activo:

```powershell
node tests/responsive/local-review.cjs
node tests/responsive/expanded-review.cjs
node tests/responsive/additional-states.cjs
node tests/responsive/public-review.cjs
```

Las pruebas usan navegadores automatizados y emulación de viewport/tacto, no un teléfono físico. La reducción de altura aproxima el teclado virtual; no verifica el teclado nativo de iOS/Android. El zoom comprobado amplía fuentes CSS al 200 % y no equivale a todas las configuraciones de accesibilidad de cada sistema. No se ejecutan guardados comerciales ni operaciones de pago; el checkout real se revisa vacío y sus estados de lógica mediante regresiones con fixtures. No se ha realizado una auditoría formal completa de WCAG/lector de pantalla. Permanecen los siete fallos históricos de Jest descritos arriba.
