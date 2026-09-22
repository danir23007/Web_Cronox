# Indicador de carga de la portada — 22 septiembre 2026

Base: `f639455`. Árbol limpio al empezar. Navegador: Chrome 153.0.8010.50,
Windows, headless con CDP. Medición local: archivos reales del frontend,
servidor estático Express con soporte Range, API simulada; no se arrancó Nest,
no se conectó ninguna base de datos. Producción: visita anónima de solo lectura;
se bloquearon las peticiones distintas de GET/HEAD/OPTIONS. No se desactivó
la seguridad del navegador. Se inspeccionaron fotogramas del vídeo facilitado
(18,2 s), que muestran el indicador nativo activo sobre la tienda visible.

## Causa demostrada localmente

`index.html` carga `assets/CRONOX-GIF.gif` en `#preloader`: 7.036.718 bytes,
HTTP 200, `image/gif`, iniciado por el parser. `app.js` y el respaldo inline
retiraban el nodo al acabar la transición de 600 ms, pero retirar un `<img>`
no cancela su descarga ni libera necesariamente su bloqueo de `window.load`.

En red limitada (200.000 bytes/s bajada, 100.000 subida, 150 ms latencia),
la página ya era visible y el hero reproducía mientras el GIF seguía pendiente.
Al completar el GIF, se emitieron `load` y `Page.frameStoppedLoading`.
Bloquear solamente ese recurso en una prueba de aislamiento redujo `load`
de 53,043 s a 3,546 s. Ese bloqueo NO es la solución entregada.

Otra prueba sirve los primeros 64 KiB del GIF y deja su respuesta sin terminar.
Antes: a los 10 s, `interactive`, sin `load`, sin `frameStoppedLoading`,
única petición pendiente: GIF. Después: `complete`, `load` a 0,836 s,
`frameStoppedLoading` a 0,843 s. Esto demuestra causalidad sin confundir
actividad de red con carga del documento.

## Corrección y archivos

- `cronox-front/assets/app.js`: retira `srcset` y `src` exclusivamente de las
  imágenes del preloader al concluir la transición existente, antes de eliminarlo.
- `cronox-front/index.html`: idéntica limpieza en el respaldo que funciona sin
  `app.js`; actualización de su referencia a `app.js?v=71` en la portada.
- `cronox-backend/scripts/measure-storefront-performance.cjs`: registra cuándo
  se libera la imagen en la simulación existente.
- `cronox-backend/src/frontend/storefront-preloader-performance.spec.ts`: prueba
  ambas rutas con DOM real, preservación de imágenes ajenas/hero, duración de
  transición y exclusión del loader persistente de checkout.
- `cronox-backend/src/frontend/storefront-shared-systems.dom.spec.ts`: referencia
  de versión actualizada para la portada.
- `cronox-backend/scripts/diagnose-page-loading.cjs`: auditoría reproducible
  con Chrome/CDP y fixture local de respuesta GIF atascada.
- Este informe y `browser-loading.json`: mediciones filtradas; no contienen
  cookies, cabeceras de autorización ni cuerpos de peticiones.

No se cambia ningún recurso visual, CSS, favicon, hero, configuración de medios,
datos ni políticas de sesión. La descarga del GIF solo se cancela cuando ya
ha terminado su función visual. El GIF puede aparecer como `ERR_ABORTED` en
Network: es el resultado esperado de esa limpieza específica.

## Mediciones

Tiempos de Navigation Timing desde el inicio de navegación; cifras individuales,
no medianas. El tiempo de eventos CDP tiene un origen ligeramente anterior.

| Caso | DCL antes | load antes | DCL después | load después |
|---|---:|---:|---:|---:|
| Portada, caché fría, red normal | 0,140 s | 0,362 s | 0,218 s | 0,535 s |
| Portada, caché caliente, red normal | 0,105 s | 0,140 s | 0,116 s | 0,153 s |
| FAQ, caché fría, red normal | 0,070 s | 0,079 s | 0,064 s | 0,073 s |
| Portada, caché fría, red limitada | 3,689 s | 53,043 s | 3,711 s | 4,477 s |
| GIF atascado, red normal | 0,126 s | No ocurre en 10 s | 0,138 s | 0,836 s |

La repetición posterior con red limitada dio `load=4,495 s` y
`frameStoppedLoading=4,499 s`. El hero seguía descargándose con HTTP 206 y
reproduciéndose: esa petición pendiente NO retenía la carga de la pestaña.

Móvil 390×844 con GIF atascado: `load=0,847 s`, frame detenido a 0,855 s.
Con `app.js` bloqueado y GIF atascado: el respaldo terminó a 4,263 s,
respetando sus temporizadores previos. En las comprobaciones después del arreglo,
una navegación y un ciclo de carga por visita, sin recargas recurrentes.
Favicon: HTTP 200, `image/png`, 11.204 bytes; no es el recurso bloqueante.
Hero: `paused=false`, `readyState=4`, tiempo de reproducción progresando.

## Producción y límites

`https://cronox.es/` entrega actualmente la pantalla clave a una visita anónima;
`/faqs` redirige a esa pantalla. No se accedió a la portada protegida ni se
intentó sortear el acceso. La versión desplegada no se identifica con certeza.
Por tanto, el fallo local está confirmado; la atribución exacta de la sesión
de producción del usuario aún requiere comprobar esa portada con acceso.

Pantalla clave: carga normal fría 1,215 s, caliente 0,379 s. Con red limitada,
a los 15 s permanecen pendientes su GIF de 7 MB y una imagen de fondo de
16,16 MB. Es otra composición; no se modificó basándose en esa observación.

Las verificaciones de catálogo, galería, newsletter, autenticación, cesta y
checkout se cubren con regresiones existentes. El navegador local usa API
simulada y no prueba inventario ni compras reales. CDP confirma la terminación
del estado de carga; no observa directamente el indicador de la barra de
pestañas de Chrome. La vista headless no reemplaza esa comprobación manual.

## Reproducir la regresión en PowerShell

Desde la raíz del repositorio, con Chrome instalado:

```powershell
$env:AUDIT_QUICK='1'
$env:AUDIT_WAIT_MS='10000'
$env:AUDIT_STALL_GIF='1'
$env:AUDIT_ASSERT_COMPLETE='1'
$env:AUDIT_OUTPUT="$env:TEMP\cronox-loading-regression.json"
node cronox-backend/scripts/diagnose-page-loading.cjs local
```

Las aserciones fallan si no llegan `complete`, `load` y `frameStoppedLoading`,
si se reinicia la navegación, si queda pendiente el GIF o si el hero no reproduce.
`CHROME_PATH` permite seleccionar otra instalación de Chrome. Para la matriz
normal, eliminar `AUDIT_QUICK` y `AUDIT_STALL_GIF` del entorno.

## Validación final

- Suite Jest completa: 146 suites, 1.313 pruebas aprobadas (55,908 s).
- Regresión específica del preloader: 8 pruebas aprobadas, incluyendo el
  respaldo sin app y el loader persistente de checkout.
- `npm run admin:build` y `npm run build:compiled`: correctos.
- `npx tsc -p tsconfig.admin.json --noEmit`: correcto.
- ESLint de los dos archivos de pruebas modificados: correcto.
- `node --check` de `app.js` y ambos scripts de diagnóstico: correcto.
- `git diff --check`: sin errores; únicamente avisos de conversión LF/CRLF.
- Auditoría CDP con aserciones: matriz local fría/caliente/FAQ/red limitada,
  móvil y respaldo sin app aprobados. No hubo excepciones JavaScript en esas
  capturas. Las peticiones de escritura se bloquearon deliberadamente.

## Comprobación manual

1. Con acceso a la tienda, abrir la portada con caché fría y red limitada.
2. Confirmar que el indicador de pestaña cesa y aparece el favicon, mientras
   el hero sigue reproduciéndose; repetir con caché caliente y en móvil.
3. Navegar a FAQ y volver; comprobar catálogo, galería y apertura de cesta.
4. Confirmar que la newsletter sigue sin mostrarse con sesión iniciada.

No se hizo commit, push, PR, migración, cambio de datos ni despliegue.
