const { chromium, expect } = require("@playwright/test");
const { mkdirSync } = require("node:fs");
const { run } = require("./integration.cjs");
run(async ({ db, tag, password, actor, categories }) => {
  await db.product.createMany({
    data: Array.from({ length: 51 }, (_, i) => ({
      name: tag + " browser " + i,
      slug: tag + "browser" + i,
      price: 2500,
    })),
  });
  const browser = await chromium.launch(),
    page = await browser.newPage();
  mkdirSync("test-results/admin-bulk", { recursive: true });
  try {
    page.on("pageerror", (e) => console.log("Page error:", e.message));
    await page.goto("http://localhost:3000/admin.html");
    await page.locator("#adminLoginEmail").fill(actor.email);
    await page.locator("#adminLoginPassword").fill(password);
    await page.locator("#adminLoginSubmit").click();
    await page.waitForURL("**/admin.html");
    await page.goto("http://localhost:3000/admin.html#section-products");
    const section = page.locator("#section-products"),
      bar = section.locator(".bulk-selection");
    await section
      .locator("details.filters-panel")
      .evaluate((e) => (e.open = true));
    const search = section.locator("input[type=search]");
    await search.fill(tag);
    await expect(section.locator("#productsPageInfo")).toContainText(
      "54 resultados",
    );
    await expect(section.locator("#productsBody [data-bulk-id]")).toHaveCount(
      50,
    );
    const first = section.locator("[data-bulk-id]").first();
    await first.check();
    await expect(bar).toContainText("1 seleccionados");
    expect(
      await section
        .locator('input[aria-label="Seleccionar esta página"]')
        .evaluate((e) => e.indeterminate),
    ).toBe(true);
    await section.locator("#productsNext").click();
    await expect(section.locator("#productsBody [data-bulk-id]")).toHaveCount(
      4,
    );
    await expect(bar).toContainText("1 seleccionados");
    await section
      .locator('input[aria-label="Seleccionar esta página"]')
      .check();
    await expect(bar).toContainText("5 seleccionados");
    await bar
      .getByRole("button", {
        name: "Seleccionar todos los resultados filtrados",
      })
      .click();
    await expect(bar).toContainText("54 seleccionados");
    await bar.getByRole("button", { name: "Editar seleccionados" }).click();
    const dialog = page.locator(".admin-bulk-dialog");
    await expect(dialog).toContainText("Valores distintos");
    await expect(
      dialog.getByRole("button", { name: "Revisar cambios" }),
    ).toBeDisabled();
    await dialog.locator("[data-bulk-field=isActive]").selectOption("false");
    await dialog.locator("[data-bulk-field=categoryMode]").selectOption("add");
    await expect(
      dialog.getByRole("button", { name: "Revisar cambios" }),
    ).toBeDisabled();
    await dialog
      .locator(`[data-bulk-category][value="${categories[1].id}"]`)
      .check();
    await dialog.getByRole("button", { name: "Revisar cambios" }).click();
    await expect(dialog).toContainText("sin cambios");
    for (const theme of ["light", "dark"])
      for (const width of [320, 390, 768, 1366]) {
        await page.evaluate(
          (t) => (document.documentElement.dataset.adminTheme = t),
          theme,
        );
        await page.setViewportSize({
          width,
          height: width === 320 ? 480 : 850,
        });
        await expect
          .poll(() => dialog.evaluate((e) => e.scrollWidth <= e.clientWidth))
          .toBe(true);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        await page.screenshot({
          path: `test-results/admin-bulk/bulk-products-${theme}-${width}.png`,
        });
        await dialog
          .getByRole("button", { name: "Cerrar", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          dialog.getByRole("button", { name: "Cerrar", exact: true }),
        ).toBeInViewport();
        if (width === 320)
          await page.screenshot({
            path: `test-results/admin-bulk/bulk-actions-${theme}-320.png`,
          });
        await dialog.evaluate((e) => (e.scrollTop = 0));
      }
    // A concurrent edit requires a fresh review and preserves chosen fields.
    const changedProduct = await db.product.findFirst({
      where: { slug: { startsWith: tag } },
    });
    await db.product.update({
      where: { id: changedProduct.id },
      data: { name: tag + " concurrent" },
    });
    await dialog.getByRole("button", { name: /Aplicar cambios a/ }).click();
    await expect(dialog).toContainText("han cambiado");
    await expect(dialog.locator("[data-bulk-field=isActive]")).toHaveValue(
      "false",
    );
    await dialog.getByRole("button", { name: "Revisar cambios" }).click();
    await expect(dialog).toContainText("Revisa el resumen");
    // The write succeeds but its response is lost: query the durable outcome.
    await page.route("**/api/admin/bulk/execute", async (route) => {
      const res = await route.fetch();
      expect(res.status()).toBe(201);
      await route.abort();
    });
    await dialog.getByRole("button", { name: /Aplicar cambios a/ }).click();
    await expect(dialog).toContainText("Resultado no confirmado");
    await expect(
      dialog.getByRole("button", { name: "Cerrar", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Consultar resultado" }).click();
    await expect(dialog).toContainText("Completado:");
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(bar.locator(".bulk-actions")).toBeHidden();
    await expect(search).toHaveValue(tag);
    await expect(section.locator("#productsPageInfo")).toContainText(
      "Página 2",
    );
    expect(
      await db.product.count({
        where: { slug: { startsWith: tag }, isActive: true },
      }),
    ).toBe(0);
    await section.locator("[data-bulk-id]").first().check();
    await search.fill(tag + " browser");
    await expect(bar).toContainText("Selección limpiada");
    await page.goto("http://localhost:3000/admin.html#section-users");
    const users = page.locator("#section-users");
    await users
      .locator("details.filters-panel")
      .evaluate((e) => (e.open = true));
    await users.locator("#usersSearch").fill(tag);
    await expect(users.locator("[data-bulk-id]")).toHaveCount(5);
    await users
      .locator(".bulk-selection")
      .getByRole("button", {
        name: "Seleccionar todos los resultados filtrados",
      })
      .click();
    await users
      .locator(".bulk-selection")
      .getByRole("button", { name: "Editar seleccionados" })
      .click();
    await expect(dialog).toContainText("Valores distintos");
    await dialog.locator("[data-bulk-field=role]").selectOption("USER");
    await dialog.getByRole("button", { name: "Revisar cambios" }).click();
    await expect(dialog).toContainText("2 excluidos");
    for (const theme of ["light", "dark"])
      for (const width of [320, 390, 768, 1366]) {
        await page.evaluate(
          (t) => (document.documentElement.dataset.adminTheme = t),
          theme,
        );
        await page.setViewportSize({ width, height: width < 400 ? 480 : 850 });
        await expect
          .poll(() => dialog.evaluate((e) => e.scrollWidth <= e.clientWidth))
          .toBe(true);
        await page.screenshot({
          path: `test-results/admin-bulk/bulk-users-${theme}-${width}.png`,
        });
        await dialog
          .getByRole("button", { name: "Cerrar", exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          dialog.getByRole("button", { name: "Cerrar", exact: true }),
        ).toBeInViewport();
        await dialog.evaluate((e) => (e.scrollTop = 0));
      }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    console.log(
      "PASS browser: real filtered selection across pages, partial header, 54 IDs, mixed values, confirmation, lost response recovery, filter/page preservation, cleared selection, roles preview, responsive themes.",
    );
  } finally {
    await browser.close();
  }
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
