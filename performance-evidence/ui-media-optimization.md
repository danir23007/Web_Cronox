# Optimización de medios estáticos de interfaz

Fecha de medición: 2026-09-23. Navegador: Chrome 153 mediante CDP. El servidor local sirve `cronox-front` y sustituye únicamente las respuestas de API por fixtures de lectura.

## Inventario y decisión

| Uso | Fuente observada | Propiedades | Decisión |
| --- | --- | --- | --- |
| Preloader de inicio, checkout y perfil | `cronox-front/assets/CRONOX-GIF.gif` | GIF, 1280×720, 81 fotogramas, 30 ms/fotograma, 2430 ms, bucle infinito, alfa, 7.036.718 B | WebP animado optimizado. La pantalla clave conserva el GIF por exclusión expresa. |
| Imagen predeterminada de newsletter pública y preview admin | URL pública de Supabase `newsletter/chains-newsletter.jpg` en `newsletter-renderer.js` | JPEG, 612×344, sin alfa, 10.646 B en origen; transferido 11.305 B en la auditoría | Excluida: es un objeto remoto y administrado, no un recurso empaquetado. |
| Logo de topbar de inicio | `cronox-front/assets/logo_banner.png` | PNG, 680×307, alfa, 31.000 B | Nuevo WebP sin pérdida solo para la topbar de inicio. |
| Favicon | `cronox-front/public/favicon.png` | PNG, 372×372, alfa, 11.204 B | Excluido: pequeño, formato intencionado y ajeno al bloqueo de carga ya diagnosticado. |
| Placeholder de producto | `cronox-front/assets/logo_browser.png` | PNG, 709×308, alfa, 31.930 B | Excluido: se usa como fallback de producto. |
| Iconos de interfaz | `cronox-front/assets/icons/*.svg` | SVG, 265–2.086 B | Excluidos: ya son pequeños y eficientes. |

`logo_banner.png` también es poster del hero, logo de pie, logo de otras páginas y fallback. Esos consumidores siguen usando el PNG original. La nueva referencia WebP se limita al elemento `.topbar__logo-img` de `index.html`.

## Resultado de archivos

| Original | Reemplazo | Dimensiones | Tamaño original | Tamaño optimizado | Ahorro |
| --- | --- | ---: | ---: | ---: | ---: |
| `/assets/CRONOX-GIF.gif` | `/assets/CRONOX-preloader.webp` | 1280×720, 81 frames | 7.036.718 B | 4.584.550 B | 2.452.168 B (34,84 %) |
| `/assets/logo_banner.png` | `/assets/logo-topbar.webp` | 680×307 | 31.000 B | 14.650 B | 16.350 B (52,74 %) |

El WebP animado conserva 81 fotogramas, 30 ms por fotograma, duración total de 2.430 ms, bucle infinito y alfa. En seis fotogramas representativos, el SSIM mínimo fue 0,998769 y el medio 0,999279; el alfa coincidió exactamente. El logo WebP sin pérdida coincidió píxel por píxel, incluido el canal alfa.

## Medición de navegador

Los tiempos son `PerformanceNavigationTiming` en milisegundos. `frameStoppedLoading` es el evento CDP que confirma que el indicador nativo de carga puede detenerse.

| Escenario | DCL antes | DCL después | load antes | load después | frameStopped después |
| --- | ---: | ---: | ---: | ---: | ---: |
| Escritorio, caché fría | 126,4 | 128,0 | 293,6 | 273,3 | 277 |
| Escritorio, caché caliente | 98,0 | 104,6 | 132,5 | 145,3 | 150 |
| Escritorio, red limitada | 3.717,2 | 3.789,9 | 4.483,6 | 4.563,9 | 4.567 |
| Móvil, caché fría | 131,6 | 135,2 | 265,4 | 280,6 | 286 |
| Móvil, caché caliente | 88,3 | 107,3 | 123,7 | 151,7 | 157 |
| Móvil, red limitada | 3.723,0 | 3.823,5 | 4.484,0 | 4.573,4 | 4.577 |
| WebP deliberadamente inconcluso | — | 124,4 | — | 776,1 | 781 |

En caché fría de escritorio, el preloader completo pasó de 7.037.026 B transferidos en 73 ms a 4.584.859 B en 54 ms. Este `responseEnd` de 77 ms desde navegación es la cota conservadora usada para considerar toda la animación disponible. El total de página pasó de 10.444.050 B a 8.006.933 B: 2.437.117 B menos (23,33 %). En móvil, pasó de 10.444.051 B a 8.006.929 B: 2.437.122 B menos. Las mediciones caliente y limitada muestran variación de ejecución de entre 13 y 101 ms a favor de la referencia anterior; en ambos casos el preloader ya procedía de caché o era cancelado durante la transición, por lo que el beneficio medible se concentra en la transferencia fría completa.

El recurso remoto de newsletter no cambió: 10.646 B en origen y aproximadamente 11.305 B transferidos en frío; con caché caliente no transfirió cuerpo. No se descarga el GIF antiguo en inicio, checkout o perfil, y el navegador solicita una sola versión del preloader. El PNG `logo_banner.png` sigue descargándose en inicio como poster del hero; no es un duplicado accidental del logo de topbar y se mantuvo por la exclusión del hero.

## Evidencia visual y de comportamiento

- Se compararon fotogramas 0, 10, 20, 40, 60 y 80, además de composiciones lado a lado sobre fondo neutro.
- Capturas reales a 350 ms mostraron la animación durante su transición tanto a 1440×1000 como a 390×844.
- El logo conservó 680×307 intrínsecos y se mostró a 143,97×65 px en escritorio y 101,39×45,77 px en móvil, sin cambio de relación de aspecto.
- El hero continuó reproduciéndose en todas las ejecuciones (`paused: false`, `readyState: 4`).
- La prueba de respuesta de preloader inconclusa terminó en `complete`, emitió `frameStoppedLoading` y dejó cero peticiones pendientes del preloader.
- El favicon mantuvo `/favicon.png?v=4`.
- Newsletter pública y preview admin siguen usando el mismo renderer, URL remota y parámetros de encuadre; las pruebas de newsletter permanecen sin cambios funcionales.

Datos completos: `ui-media-before-desktop.json`, `ui-media-before-mobile.json`, `ui-media-after-desktop.json`, `ui-media-after-mobile.json` y `ui-media-after-stalled-preloader.json`. La investigación previa está en `browser-loading.json`.
