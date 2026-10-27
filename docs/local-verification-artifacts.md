# Archivos locales de verificación

La revisión de cambios pendientes del 27/10/2026 separó código y pruebas reutilizables de resultados temporales. No se borraron archivos ni se usaron stash, descartes, resets, `git clean` ni exclusiones privadas de Git.

Se versionan el código y los recursos del footer y de eliminación de usuarios, su documentación, las fixtures PostgreSQL y las pruebas de navegador de usuarios, recuperación del checkout y medición del footer. Los assets administrativos generados que la aplicación sirve están versionados y se regeneraron mediante `npm run admin:build`. No se añadieron migraciones porque estos ajustes no modifican el esquema.

Las exclusiones compartidas de `.gitignore` para `output/` cubren informes JSON/TXT, logs, PID, capturas, parches de comparación, archivos privados y respaldos. Los JSON revisados son resultados, instantáneas o estado privado de pruebas, no fixtures de entrada. Se conserva fuera de Git el cliente Prisma generado bajo `output/stock-reservations/generated-client/`, incluidas sus bibliotecas nativas reproducibles.

Los auxiliares de `output/checkout-incident-20261027/` son sondas puntuales del incidente: dependen de sesiones privadas, puertos temporales, revisión publicada o identificadores de los intentos de diagnóstico. Permanecen locales mediante reglas limitadas a los `.cjs` y `.cli.js` de esa carpeta fechada. La regresión permanente correspondiente está en `tests/stock-reservations/checkout-recovery-browser.cli.js` y las pruebas transaccionales de checkout ya estaban versionadas.

`output/incident-checkout-browser.cli.js` es una copia temporal de `tests/stock-reservations/checkout-browser.cli.js`, con el puerto local cambiado y una etiqueta con codificación deteriorada; se conserva localmente y se excluye. La herramienta reutilizable de medición del footer se recuperó de `output/playwright/footer-spacing/` como `tests/footer/spacing.cli.js`, con comprobaciones y documentación de ejecución. Los originales y las evidencias no se eliminaron.

Estas reglas no excluyen fuentes generales de `tests/`, `scripts/`, `docs/`, `prisma/` ni recursos de la aplicación. Los archivos temporales pueden contener cookies, direcciones ficticias, configuración local o resultados de consultas productivas; no deben incorporarse a commits ni publicarse.
