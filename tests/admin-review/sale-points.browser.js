// Run with playwright-cli run-code --filename tests/admin-review/sale-points.browser.js
// Requires scripts/test-sale-points-db.cjs --serve. Every write stays in its disposable DB.
async (page) => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const errors = [],
    failedResponses = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 500) failedResponses.push(r.url());
  });
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:43121/__review/admin");
    await page
      .getByRole("heading", { name: "Puntos de venta", exact: true })
      .waitFor();
    for (const [commission, expense, expected] of [
      [0, 200, 15000],
      [60, 0, 5000],
      [20, 100, 15000],
    ]) {
      const name = `Browser ${width} comisión ${commission} ${Date.now()}`;
      await page
        .getByRole("button", { name: "Crear punto de venta", exact: true })
        .click();
      await page.getByLabel("Nombre / edición").fill(name);
      await page
        .getByLabel("Comisión predeterminada (%)")
        .fill(String(commission));
      await page.getByLabel("Participación (€)").fill(String(expense));
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      const id = new URLSearchParams(
        new URL(page.url()).hash.split("?")[1],
      ).get("point");
      await page
        .getByRole("button", { name: "Registrar venta", exact: true })
        .click();
      const variant = await page
        .getByLabel("Producto y talla")
        .locator("option")
        .evaluateAll(
          (nodes) =>
            nodes.find(
              (n) =>
                n.textContent.includes("Camiseta local") &&
                n.textContent.includes("· M ·"),
            ).value,
        );
      await page.getByLabel("Producto y talla").selectOption(variant);
      await page.getByLabel("Cantidad", { exact: true }).fill("10");
      await page.getByLabel("Precio pagado por unidad (€)").fill("50");
      check(
        (await page
          .getByLabel("Comisión (%)", { exact: true })
          .inputValue()) === String(commission),
        "Default commission",
      );
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.locator(".pos-editor").waitFor({ state: "detached" });
      const response = await page.request.get(
        `http://127.0.0.1:43121/api/admin/sale-points/${id}?from=2026-10-01&to=2026-10-31`,
      );
      const d = await response.json();
      check(
        d.report.totals.profitCents === expected,
        "Required UI example profit",
      );
      const finance = await (
        await page.request.get(
          `http://127.0.0.1:43121/api/admin/finance?from=2026-10-01&to=2026-10-31&source=points&pointId=${id}`,
        )
      ).json();
      check(
        finance.totals.profitCents === expected,
        "General finance matches point",
      );
      check(
        finance.buckets.reduce((s, b) => s + b.profitCents, 0) === expected,
        "Chart sum",
      );
      await page.screenshot({
        path: `output/playwright/points-${width}-${commission}.png`,
        fullPage: true,
      });
      await page.reload();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      check(
        (await page.locator(".pos-metrics").innerText()).includes(
          (expected / 100).toFixed(2).replace(".", ","),
        ),
        "Persisted KPI after reload",
      );
      if (commission === 20) {
        await page
          .getByRole("button", { name: "Corregir", exact: true })
          .click();
        await page.getByLabel("Cantidad", { exact: true }).fill("9");
        await page
          .getByLabel("Motivo de la corrección")
          .fill("Corrección navegador");
        await page
          .getByRole("button", { name: "Guardar", exact: true })
          .click();
        await page.locator(".pos-editor").waitFor({ state: "detached" });
        await page
          .getByRole("button", { name: "Devolver", exact: true })
          .click();
        await page
          .getByLabel("Motivo", { exact: true })
          .fill("Devolución navegador");
        await page.getByLabel("Cantidad a devolver").fill("1");
        await page.getByLabel("Reponer stock").check();
        await page.getByLabel("Comisión recuperada (€)").fill("10");
        await page
          .getByRole("button", { name: "Guardar", exact: true })
          .click();
        await page.locator(".pos-editor").waitFor({ state: "detached" });
        const after = await (
          await page.request.get(
            `http://127.0.0.1:43121/api/admin/sale-points/${id}?from=2026-10-01&to=2026-10-31`,
          )
        ).json();
        check(
          after.report.netUnits === 8 &&
            after.report.totals.profitCents === 10000,
          "Correction/return UI",
        );
        await page
          .getByRole("button", { name: "Editar punto", exact: true })
          .click();
        await page.getByLabel("Archivado (conserva todo el historial)").check();
        await page
          .getByRole("button", { name: "Guardar", exact: true })
          .click();
        await page.locator(".pos-editor").waitFor({ state: "detached" });
        check(
          await page
            .getByRole("button", { name: "Registrar venta", exact: true })
            .isDisabled(),
          "Archived sale blocked",
        );
      }
      results.push({
        width,
        commission,
        expense,
        profit: expected,
        pointId: id,
      });
      await page
        .getByRole("button", { name: "Todos los puntos", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Puntos de venta", exact: true })
        .waitFor();
    }
    // Lose the response after the real server committed. Retry must replay the
    // same request, retaining all form values and frozen per-line amounts.
    await page
      .getByRole("button", { name: "Crear punto de venta", exact: true })
      .click();
    const retryName = `Reintento ${width} ${Date.now()}`;
    await page.getByLabel("Nombre / edición").fill(retryName);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.getByRole("heading", { name: retryName, exact: true }).waitFor();
    const retryId = new URLSearchParams(
      new URL(page.url()).hash.split("?")[1],
    ).get("point");
    await page
      .getByRole("button", { name: "Registrar venta", exact: true })
      .click();
    const opts = await page
      .getByLabel("Producto y talla")
      .locator("option")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ value: n.value, text: n.textContent })),
      );
    await page
      .getByLabel("Producto y talla")
      .selectOption(
        opts.find(
          (n) => n.text.includes("Camiseta local") && n.text.includes("· M ·"),
        ).value,
      );
    await page.getByLabel("Cantidad", { exact: true }).fill("2");
    await page.getByLabel("Precio pagado por unidad (€)").fill("25.50");
    await page.getByRole("button", { name: "Añadir prenda" }).click();
    await page
      .getByLabel("Producto y talla")
      .nth(1)
      .selectOption(opts.find((n) => n.text.includes("Chaqueta local")).value);
    await page.getByLabel("Precio pagado por unidad (€)").nth(1).fill("40");
    await page.getByLabel("Comisión (%)", { exact: true }).nth(1).fill("50");
    let lost = false;
    const routePattern = `**/api/admin/sale-points/${retryId}/sales`;
    await page.route(routePattern, async (route) => {
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        check(
          response.status() === 201,
          "Server committed before lost response",
        );
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page
      .locator(".pos-editor [data-error]")
      .filter({ hasText: /./ })
      .waitFor();
    check(
      (await page
        .getByLabel("Precio pagado por unidad (€)")
        .first()
        .inputValue()) === "25.50",
      "Failed save preserves input",
    );
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.locator(".pos-editor").waitFor({ state: "detached" });
    await page.unroute(routePattern);
    const retried = await (
      await page.request.get(
        `http://127.0.0.1:43121/api/admin/sale-points/${retryId}?from=2026-10-01&to=2026-10-31`,
      )
    ).json();
    check(
      retried.sales.length === 1 &&
        retried.report.totals.salesCount === 1 &&
        retried.report.totals.profitCents === 2100,
      "Network retry does not duplicate multi-line sale",
    );
    const last = results.at(-1);
    await page.goto(
      `http://127.0.0.1:43121/admin.html#section-dashboard?from=2026-10-01&to=2026-10-31&source=points&pointId=${last.pointId}`,
    );
    await page.locator("[data-source]").waitFor();
    check(
      (await page.locator("[data-source]").inputValue()) === "points",
      "Finance source persisted",
    );
    check(
      (await page.locator("[data-point]").inputValue()) === last.pointId,
      "Finance point persisted",
    );
    await page.locator("[data-source]").selectOption("web");
    await page.locator(".finance-content[aria-busy=false]").first().waitFor();
    check(new URL(page.url()).hash.includes("source=web"), "Source navigation");
  }
  check(errors.length === 0, "Browser errors: " + errors.join("; "));
  check(
    failedResponses.length === 0,
    "Unexpected server errors: " + failedResponses.join("; "),
  );
  return { passed: true, examples: results, errors, failedResponses };
}
