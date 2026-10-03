# Revisiones de navegador de Home y visitantes

Estas funciones Playwright conservan las comprobaciones útiles de las revisiones anteriores. Utilizan exclusivamente el servidor sintético `http://127.0.0.1:43123` de `cronox-backend/scripts/review-visitors.cjs --serve`, con PostgreSQL efímero, roles y datos de prueba. No sirven para revisar producción ni leen sus credenciales.

Desde la raíz del repositorio, con el backend compilado y PostgreSQL de pruebas disponible:

```powershell
node cronox-backend/scripts/review-visitors.cjs --serve
```

En otra terminal, para Home y el panel de visitantes:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=admin-review open http://127.0.0.1:43123/__visitorreview/SUPERADMIN
npx --yes --package @playwright/cli playwright-cli -s=admin-review run-code --filename tests/admin-review/home.browser.js
npx --yes --package @playwright/cli playwright-cli -s=admin-review run-code --filename tests/admin-review/visitors-panel.browser.js
npx --yes --package @playwright/cli playwright-cli -s=admin-review close
```

La conciliación del consentimiento necesita otro contexto de navegador con la página pública del mismo servidor:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=visitor-consent open http://127.0.0.1:43123/
npx --yes --package @playwright/cli playwright-cli -s=visitor-consent run-code --filename tests/admin-review/visitors-consent.browser.js
npx --yes --package @playwright/cli playwright-cli -s=visitor-consent close
```

Al terminar, detén el servidor de revisión con Ctrl+C; su manejador cierra Nest y PostgreSQL y retira el directorio temporal. Las capturas se generan bajo `test-results/admin-review/`, que ya está fuera de Git.

Home comprueba posición y entrada predeterminada, compatibilidad del enlace anterior, ausencia exclusiva de Atrás, otros destinos y permisos en escritorio y móvil. El panel comprueba gráfica, filtros, búsqueda y disposición móvil. Consentimiento comprueba pestañas concurrentes, conciliación tras login/logout, prueba HttpOnly, revocación, ausencia de Web Locks y errores de autenticación sin visitas invitadas.
