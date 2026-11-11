# Tarjetas agotadas y avisos por talla

Publicación solicitada el 11/11/2026, incluyendo todo el trabajo local pendiente del flujo de reposición.

- El texto compartido `product-restock__label` usa peso 700 y opacidad 1. El contenedor y el botón Avisarme conservan sus estilos. Cormorant Garamond es variable (300–700); Chromium confirma la fuente cargada para 700, el botón a 400 y sus medidas intactas a 390 y 1366 px.
- Se incluyen el rediseño de tarjetas agotadas, enlaces independientes a ficha, selector compartido por talla, continuación tras acceso, reintentos, cancelación, controles de concurrencia y destinatarios paginados protegidos en administración.
- Guardar una tirada sin cambiar disponibilidad conserva el plazo de reposición. Los recursos de frontend se recompilan y se actualizan versiones de caché.
- Se actualizan las regresiones de recomendaciones, precios y últimas unidades para comprobar el marcado y aspecto nuevos.

## Integración

Tras fetch, `origin/main` era `650f1bf07d1451b2d2ee760d7793342f50ae3716`, ya publicado mediante Actions 41759773481. Incluye tiradas, costes históricos, fechas de recepción y las migraciones correspondientes. Su árbol coincidía con la rama de trabajo `work/cronox-url-performance-20261103`; se avanzó por fast-forward sin descartar archivos. Este cambio no añade migraciones.

Las ramas locales auxiliares de release/verificación no aportaban commits nuevos respecto de main. Se revisaron dos ramas remotas antiguas sin integrar: `codex/restore-navigation-from-product-card` (2025, cambios de navegación reemplazados por el código actual) y `maintenance/stripe-checkout-verification` (auditoría independiente del runtime). No se incorporan workflows de diagnóstico antiguos a la publicación funcional.

## Verificación

Typecheck de backend y administrador, compilación de frontend/backend y comprobador de contenido privado aprobados. Regresión PostgreSQL de tiradas aprobada sobre base desechable, incluyendo conservación de `readyAt`. Flujo de navegador con Nest y PostgreSQL aislados: ficha, continuación tras acceso, talla explícita, doble clic, concurrencia, error real de inserción y reintento; tamaños 320, 390, 430 y 1366. Recepción y activación de tiradas generan dos avisos aceptados por transporte simulado, sin duplicados. No se crean solicitudes ni se envían correos de prueba en producción.

Evidencia local excluida de Git: `output/playwright/restock-flow/` y `output/restock-*-current.log`. Bases desechables, dumps, sesiones y credenciales quedan fuera del commit.
