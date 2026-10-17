# Revisión de dependencias — 17 de octubre de 2026

## Alcance y conclusión

Revisión sólo de lectura de `backend-npm-audit.json` y `root-npm-audit.json` aportados en esta auditoría (decodificados como UTF-16LE), ambos lockfiles, los `package.json` instalados y las llamadas del código actual. Se consultaron los avisos oficiales de GitHub el 17/10/2026. No se instalaron paquetes, ejecutaron payloads, actualizaron dependencias ni consultó producción. Este documento prueba versiones y rutas de código; no certifica el árbol instalado en el VPS ni demuestra explotación.

El backend presenta **50 entradas de paquetes afectadas: 2 críticas, 41 altas y 7 moderadas**. Se reducen a **18 avisos distintos en 10 paquetes causales**. Las demás entradas son propagaciones por dependencias, especialmente Jest/Babel/globbing; no son 50 vulnerabilidades independientes de la aplicación. La raíz presenta una entrada alta: el mismo aviso de `source-map-js`, en otra instalación usada por Vite.

Las versiones afectadas están confirmadas en lockfile y `node_modules`. **No se ha confirmado una ruta pública explotable para los avisos críticos**: las condiciones descritas por Handlebars y proxy-addr no aparecen en las llamadas revisadas. Sigue siendo apropiado actualizar esas dependencias de ejecución mediante un cambio pequeño y validado; una inferencia estática de no aplicabilidad no reemplaza el mantenimiento.

## Inventario agrupado por causa

La severidad de la tabla es la del aviso/entrada npm, no una valoración de explotación efectiva en CRONOX. Las versiones corregidas se limitan a estos avisos; no afirman que una versión esté libre de cualquier otro problema.

| Paquete y versión real | Avisos de origen / severidad máxima | Cadena y uso verificado | Aplicabilidad actual y actuación propuesta |
|---|---|---|---|
| `handlebars 4.7.9` | 3; crítica | Dependencia directa de ejecución; también requerida por ts-jest | Usado para correos. No se observan AST no fiables, opciones de prototipos permisivas ni JavaScript precompilado incrustado. Actualización acotada propuesta a `4.7.10`; detalle debajo. |
| `proxy-addr 2.0.7` | 1; crítica | `@nestjs/platform-express → express 5.2.1 → proxy-addr` | Se ejecuta para identidad IP. El código configura número de saltos, no subredes; la condición específica del aviso no se alcanza por esa configuración. Proponer `2.0.8` compatible y conservar pruebas de identidad IP. |
| `source-map-js 1.2.1` | 1; alta | Backend: `sanitize-html 2.17.7 → postcss 8.5.28`; raíz: `vite → postcss 8.5.26` | Backend sí lo instala en producción, pero la sanitización usa `map:false`, que evita consumir mapas anteriores. En raíz es herramienta dev/build. No se encontró consumidor público de mapas no fiables. Proponer `1.2.2` en ambos árboles. |
| `deepmerge-ts 7.1.5` | 1; alta | `prisma 6.19.3 → @prisma/config 6.19.3` | Uso identificado de configuración/CLI, sin importación directa en servicios HTTP. El lock no lo marca dev, debido al grafo de Prisma; no describirlo como ausente del árbol productivo. Requiere grafos cíclicos de objetos, que JSON plano no representa. Evaluar solución compatible con Prisma; no ejecutar `audit fix --force`. |
| `fast-uri 3.1.5` | 6; alta | AJV 8 de Angular Devkit/Nest schematics/Webpack/Terser; entradas dev | No se encontró importación en `src` ni decisión de URL HTTP/SSRF basada en este paquete. Actualizar la rama 3.x a `3.1.8` como mínimo para cubrir los seis avisos y validar build/schemas. |
| `browserslist 4.28.1` | 2; alta | Babel compilation targets/Webpack; dev | Procesamiento de consultas/configuración de compilación, no servicio público de consultas de navegador. Actor relevante: quien controla configuración/estadísticas del build. Proponer `4.28.7`. |
| `baseline-browser-mapping 2.9.19` | 1; moderada | Browserslist; dev | Parámetros inválidos pueden terminar el proceso de la herramienta. No se identificó entrada pública que los controle. Proponer `2.11.0`. |
| `braces 3.0.3` | 1; alta | Micromatch, que propaga a Jest, fast-glob, utilidades TypeScript y ts-loader; dev | Patrones anidados no fiables afectan a herramientas. No se encontró API pública que acepte patrones para ese motor. Aviso oficial: **sin versión corregida**; no presentar `npm fixAvailable:true` como prueba de parche. Mantener patrones de configuración controlados y revisar actualización del consumidor cuando exista solución compatible. |
| `sprintf-js 1.0.3` | 1; moderada | `@istanbuljs/load-nyc-config → js-yaml 3.15.2 → argparse 1.x → sprintf-js`; dev | Requiere control de cadenas de formato; la cadena observada es de cobertura/CLI. Aviso oficial: **sin versión corregida**; revisar eliminación/actualización del consumidor, sin prometer que un parche ya exista. |
| `@humanfs/node 0.16.7` | 1; moderada | ESLint; dev | El aviso concierne copias con enlaces simbólicos controlados por un tercero. No se halló esta biblioteca en las rutas de carga/descarga del servidor. La presencia en ESLint no prueba que su API de copia afectada sea invocada por el proyecto. Proponer `0.16.8` en tooling. |

## Handlebars: llamadas reales y condiciones

**Versión afectada confirmada; explotación en la aplicación no demostrada.** El paquete está fijado directamente a `4.7.9`, por lo que la actualización de esa dependencia directa exige un cambio deliberado de manifest/lock.

- `src/email/email.service.ts:259–268` elige un archivo del catálogo de plantillas y lo lee con `readFile(..., 'utf8')`; compila un string. `:245–248` lo renderiza sin habilitar opciones de acceso a prototipos.
- `src/email/managed/mail.dto.ts:31–38` exige strings para asunto, preheader y texto alternativo. La validación global está en `src/main.ts:158–165`. El documento visual sí es objeto, pero **no se pasa como AST a Handlebars**: `mail-renderer.ts:184–204` valida estructura y propiedades textuales; `:336–343` construye un string a partir de los bloques.
- `mail-renderer.ts:150–169` restringe expresiones a variables y bloques del catálogo. Llama a `Handlebars.precompile(source)` para validar sintaxis y descarta el resultado; no lo entrega como JavaScript a un `<script>`.
- `mail-renderer.ts:357–362` compila strings y renderiza con `allowProtoMethodsByDefault:false` y `allowProtoPropertiesByDefault:false` explícitos.
- `managed-mail.service.ts:579–588` valida el texto alternativo con el mismo vocabulario y compila el string de DTO/columna de BD. `noEscape:true` aquí se usa para salida de texto; no habilita acceso a prototipos. No se encontró `allowProtoMethodsByDefault:true` en `src`.
- El editor está detrás de `JwtAuthGuard`, `AdminGuard`, `RolesGuard` en `managed-mail.controller.ts:47–49`. No se debe describir como exclusivamente SUPERADMIN sólo por su decorador: la semántica compartida actual de roles admite administradores, documentada en la revisión de ACL. Los controles de tipos y plantillas siguen siendo relevantes aun dentro del editor administrativo.

El aviso de **AST** exige que un objeto no fiable llegue a compile/precompile y excluye el uso exclusivo de strings; el de **propiedad propia** describe una plantilla controlada con acceso permisivo a métodos de prototipo; el de **script inline** requiere insertar en HTML el JavaScript producido por precompile y excluye el renderizado ordinario en servidor. Esas condiciones no se observan en las rutas anteriores. Esta es una conclusión estática limitada a las llamadas actuales, no una prueba general de seguridad del motor. Fuentes: [AST y versión 4.7.10](https://github.com/advisories/GHSA-8r5x-fm3f-whwj), [acceso a prototipos](https://github.com/advisories/GHSA-p8wg-vrv2-v86f), [incrustación inline](https://github.com/advisories/GHSA-xw65-4hp5-5hc7).

Propuesta de validación de una futura actualización: render de plantillas originales y administradas, variables escapadas, bloques if/each, texto alternativo, previsualización, rechazo de objetos en campos string y regresión de sanitización. No requiere enviar correos reales.

## proxy-addr: confianza numérica frente a la condición del aviso

`src/common/config/environment.ts:232–238` devuelve un entero no negativo para `TRUST_PROXY_HOPS`, por defecto cero. `src/main.ts:59–60` configura `expressApp.set('trust proxy', trustedProxyHops)` sólo si es positivo; en otro caso queda la confianza desactivada por defecto de Express.

En el Express instalado, `node_modules/express/lib/utils.js:202–205` convierte un número en una función que compara el índice del salto. La compilación de listas/subredes queda en `:213`. `node_modules/proxy-addr/index.js:64–66` sólo compila la confianza si no es ya una función. Por tanto, el camino numérico de la aplicación evita el comparador de subredes IPv4/IPv6 afectado. El aviso exige una subred IPv6 concreta configurada como confianza; no afirma que toda llamada a `req.ip` sea vulnerable. [Aviso oficial y parche 2.0.8](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).

Esto **no valida la topología real de proxies**, la cantidad configurada en producción ni si un cliente puede alcanzar el origen por un camino más corto. Es una cuestión independiente del advisory y permanece fuera de esta revisión local. Actualizar el paquete sigue siendo razonable; las pruebas propuestas deben preservar IP por socket, un salto confiado y tratamiento de cabeceras no confiables.

## source-map-js: no confundir presencia runtime con consumo de mapas

El backend lo instala sin `dev:true` a través de sanitize-html, utilizado por correos y otros HTML sanitizados. La llamada concreta en `node_modules/sanitize-html/index.js:514–516` usa `postcssParse(..., {map:false})`. En el PostCSS instalado, `node_modules/postcss/lib/previous-map.js:26–30` retorna antes de cargar anotaciones o mapas cuando `opts.map === false`. No se encontró importación directa de source-map-js o PostCSS en `src`.

La raíz lo usa mediante PostCSS/Vite como dependencia de desarrollo. La condición del aviso es procesar mapas indexados no fiables con offsets de sección problemáticos; no basta recibir HTML o un atributo style en la ruta de sanitización revisada. No se ejecutó ninguna prueba de bloqueo de event loop. La corrección publicada es `1.2.2`. [Aviso oficial](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

## Configuración/CLI y desarrollo

`deepmerge-ts 7.1.5` proviene de `@prisma/config`, no del merge usado por la conversión de correo: `html-to-text` tiene su propia copia **8.0.2**, ya fuera del rango de este aviso. Prisma figura en `devDependencies` del manifest, pero su entrada del lock y las de `@prisma/config`/deepmerge no llevan `dev:true`; `@prisma/client` declara Prisma como peer opcional. La etiqueta de npm por sí sola no describe qué código se ejecuta al atender una petición. No se halló importación del CLI/config en `src`. El aviso precisa objetos con referencias cíclicas, no simple JSON. El `fixAvailable` de la auditoría propone **Prisma 7.10.1, salto mayor**: requiere estudio separado de compatibilidad con el cliente, generación y configuración, no una corrección automática de mantenimiento. [Aviso oficial de deepmerge-ts, corregido en 8.0.0](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).

Los seis avisos de fast-uri comparten la familia de normalización/serialización de autoridades URI, aunque sus condiciones no son idénticas. La versión instalada 3.1.5 cae en todos. Los cuatro primeros se corrigen en 3.1.6, el quinto en 3.1.7 y el sexto en 3.1.8. En este árbol llega por AJV de herramientas dev; no se ha vinculado a las decisiones de host de la aplicación. Fuentes: [IDN](https://github.com/advisories/GHSA-5jgf-p345-68v8), [IPv6](https://github.com/advisories/GHSA-f65p-4m7j-42xc), [decodificación de host](https://github.com/advisories/GHSA-fph4-wmhf-6fwf), [esquema](https://github.com/advisories/GHSA-jqff-g426-hqxp), [puerto](https://github.com/advisories/GHSA-qw65-cvwx-89v3), [normalización de mayúsculas](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).

Browserslist requiere revisar tanto la caché de consultas como estadísticas externas; los dos avisos indican 4.28.7 como parche. En CRONOX es tooling Babel/Webpack, sin consultas suministradas por clientes encontradas. Baseline-browser-mapping, debajo de Browserslist, termina el proceso ante parámetros inválidos y se corrige en 2.11.0. Fuentes: [caché de consultas](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [estadísticas](https://github.com/advisories/GHSA-73wf-gq98-2v4g), [baseline-browser-mapping](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv).

Braces y sprintf-js no tienen parche indicado en los avisos consultados. Aun cuando npm marca `fixAvailable:true`, eso no constituye evidencia de una versión del paquete causal corregida. La presencia de numerosos paquetes Jest en la salida se explica por su dependencia de esos componentes. No corresponde sumar cada propagación como un fallo nuevo de HTTP. [Braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

El aviso de humanfs exige operaciones de copia sobre rutas con symlinks no fiables; la dependencia observada pertenece a ESLint. No se ha probado que el proyecto invoque la operación vulnerable. El parche es 0.16.8. [Aviso oficial](https://github.com/advisories/GHSA-p498-v437-472g).

## Orden propuesto para una corrección posterior

1. Cambio revisable de dependencias de ejecución: Handlebars, proxy-addr y source-map-js; pruebas de correo, sanitización y proxy, sin servicios externos. Mantener el mismo comportamiento de autenticación, rate limits y plantillas.
2. Actualizar dependencias de tooling con parches disponibles, después build, lint y pruebas. Aislar CI ante entradas de repositorios no confiables; que sean dev no elimina el riesgo para el proceso que las ejecuta.
3. Revisar Prisma/deepmerge por separado y mantener seguimiento de braces/sprintf-js hasta disponer de una solución compatible. No aplicar overrides mayores o `audit fix --force` sólo para reducir el contador.
4. Volver a generar auditorías después de cualquier cambio, revisar diferencias de ambos lockfiles y comprobar el árbol realmente desplegado en un paso posterior autorizado. Esta fase no modificó nada de lo anterior.

## Reproducibilidad y límites

- Los diez paquetes causales del backend y source-map-js de raíz tienen la misma versión en el lock y el `package.json` instalado localmente.
- SHA-256 exacto del lock backend: `0e612848a19f6af4c4ab60f9d8a7f195b6361be0ef09cc0371e22ffce9244d07`.
- SHA-256 exacto del lock raíz: `447200bfbfb1e3804e769afcc3fb96e7773f446dc89abba714050a28e22283ca`.
- Contador reproducible: deduplicar objetos de `vulnerabilities[*].via` por URL; las entradas string son referencias a otras dependencias, no avisos adicionales.
- No se afirma seguridad total por ausencia de una llamada identificada. No se revisaron todas las rutas internas de todas las dependencias transitivas, ni la configuración runtime del VPS, ni paquetes fuera de los dos informes. Las líneas corresponden al árbol local actual.
- No hubo exploits, carga de denegación de servicio, instalaciones, cambios de manifest/lock, acceso a producción ni lectura de secretos para esta clasificación.

## Actualización de la fase de corrección local

El inventario anterior queda conservado como referencia. En la intervención posterior del 17/10/2026 se aplicaron parches compatibles: Handlebars **4.7.10**, proxy-addr **2.0.8**, source-map-js **1.2.2** en ambos árboles, fast-uri **3.1.8**, Browserslist **4.28.7**, baseline-browser-mapping **2.11.0** y @humanfs/node **0.16.8**. El lock incorpora sólo sus dependencias requeridas; son doce nodos backend y un nodo raíz. El único cambio del manifest es Handlebars. No se cambió Prisma, se añadieron overrides mayores ni se utilizó `audit fix --force`.

Los árboles instalados coinciden con los locks. Auditorías finales: backend **43 entradas (0 críticas, 38 altas, 5 moderadas)** frente a 50 (2/41/7); raíz **0** frente a 1 alta. Las entradas propagadas no equivalen a 43 vulnerabilidades independientes de la web. Los parches de ejecución y herramientas se prepararon en copias y se instalaron después de terminar la suite funcional, con scripts de instalación desactivados. Siete suites de correo/sanitización/proxy y 69 tests pasaron después; tres controles directos adicionales comprobaron source-map en ambos árboles y la subred proxy afectada.

**MNT-01 permanece parcialmente abierto:** braces y sprintf-js no tienen parche publicado en las fuentes consultadas; deepmerge-ts requiere una rama mayor que no se fuerza bajo Prisma 6. La explotabilidad de esos caminos en CRONOX no está demostrada. Mantener entradas de tooling controladas y planificar Prisma aparte no equivale a declarar el riesgo eliminado. El contador cero de críticas tampoco es una certificación de seguridad.

La [evidencia de dependencias](../output/playwright/audit-fixes-20261017/security/dependency-candidate/README.md) conserva fuentes primarias, diferencias semánticas, hashes, versiones instaladas, auditorías y resultados. Las compilaciones y la conclusión de publicación se recogen en la sección 11 del [informe principal](audit-cronox-2026-10-17.md). No se publicó ni modificó producción.

## Cierre previo a publicación

La nueva auditoría conserva los contadores 43 backend / 0 raíz. Registro npm: braces 3.0.3 y sprintf-js 1.1.3 siguen siendo las últimas versiones consultadas y están afectadas; Prisma 6.19.3 sigue fijando deepmerge-ts 7.1.5. No se aplicó una actualización sin beneficio ni un override incompatible. El servidor recompilado en localhost carga Handlebars 4.7.10, proxy-addr 2.0.8, source-map-js 1.2.2 y la copia de deepmerge-ts 8.0.2 de html-to-text. No se observaron cargados braces, sprintf-js, Prisma CLI/config o su deepmerge-ts 7.1.5. Esto confirma los recorridos locales, no todo código potencial.

El contraste posterior del VPS, sólo lectura, confirma las tres versiones residuales instaladas y ninguna importación directa en 1073 archivos fuente/compilados. No se consultó la memoria/configuración de PM2. Producción todavía conserva Handlebars 4.7.9, proxy-addr 2.0.7 y source-map-js 1.2.1: los parches locales no deben describirse como publicados. Revisión en disco `5e5e1e7`, ancestro de HEAD; evidencia `prepublish-20261017/deployed-versions.json`. Sin instalación ni cambios remotos.

La [tabla de riesgos residuales y alternativas](audit-prepublication-2026-10-17.md#2-dependencias-residuales-y-decisión-pendiente) detalla rangos, condiciones, mitigaciones y la decisión que estaba pendiente al cerrar esa revisión. Evidencias nuevas: `prepublish-20261017/backend-audit.json`, `root-audit.json` y `local-runtime.json`. Build/typecheck y recorridos de arranque/HTTP pasan con los mismos locks.

**Decisión posterior del titular, 17/10/2026:** aceptación expresa, exclusivamente para esta publicación, del riesgo residual documentado de braces 3.0.3, sprintf-js 1.0.3 y deepmerge-ts 7.1.5 incorporado por Prisma. Se mantienen las condiciones de exposición y mitigaciones revisadas. No se consideran corregidas las vulnerabilidades. Seguimiento pendiente: parches de braces/sprintf-js y actualización compatible de Prisma; revisar esta aceptación si cambia la exposición o aparece una corrección aplicable. La publicación está autorizada, sujeta al procedimiento operativo del informe de prepublicación.
