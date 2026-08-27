const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

test("permite buscar y administrar accesos en la vista previa", async ({ page }) => {
  await page.goto("/?preview");
  await expect(page.getByRole("heading", { name: /Jesús/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tus imprescindibles" })).toBeVisible();
  await expect(page.locator("#total-stat")).toHaveText("6");
  await expect(page.locator("#favorite-stat")).toHaveText("3");
  await expect(page.locator("#favorites-grid").getByRole("link", { name: /Gmail/ })).toBeVisible();

  await page.getByLabel("Buscar accesos").fill("GitHub");
  await expect(page.getByRole("heading", { name: "Tus imprescindibles" })).toBeHidden();
  await expect(page.getByRole("link", { name: /GitHub/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /YouTube/ })).toBeHidden();
  await page.getByLabel("Buscar accesos").clear();

  await page.getByRole("button", { name: /Nuevo acceso/ }).click();
  await page.getByRole("dialog").getByLabel("Nombre").fill("MDN");
  await page.getByLabel("Dirección web").fill("https://developer.mozilla.org");
  await page.getByRole("dialog").getByLabel("Categoría").fill("Desarrollo");
  await page.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(page.getByRole("link", { name: /MDN/ })).toBeVisible();

  await page.getByRole("button", { name: "Editar acceso: MDN" }).click();
  await page.getByRole("dialog").getByLabel("Nombre").fill("MDN Web Docs");
  await page.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(page.getByRole("link", { name: /MDN Web Docs/ })).toBeVisible();

  await page.getByRole("button", { name: /Marcar como favorito: MDN Web Docs/ }).click();
  await page.getByRole("button", { name: "Editar acceso: MDN Web Docs" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.getByRole("link", { name: /MDN Web Docs/ })).toHaveCount(0);
});

test("permite ordenar accesos en escritorio y móvil", async ({ page }, testInfo) => {
  await page.goto("/?preview");
  const cards = page.locator(".link-card");
  await expect(cards.nth(0).getByRole("link", { name: /Gmail/ })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Mover Gmail hacia abajo" }).click();
  } else {
    await page.getByRole("button", { name: /Ordenar acceso: Gmail/ }).press("ArrowDown");
  }
  await expect(cards.nth(0).getByRole("link", { name: /GitHub/ })).toBeVisible();
  await expect(cards.nth(1).getByRole("link", { name: /Gmail/ })).toBeVisible();
});

test("exporta, importa y organiza la colección", async ({ page }) => {
  await page.goto("/?preview");
  await page.getByRole("button", { name: "Administrar colección" }).click();
  const accessibility = await new AxeBuilder({ page }).include("#collection-dialog").analyze();
  expect(accessibility.violations).toEqual([]);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar respaldo" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^atajo-respaldo-\d{4}-\d{2}-\d{2}\.json$/);

  const backup = {
    format: "atajo-backup",
    version: 1,
    links: [
      { name: "MDN", url: "https://developer.mozilla.org", category: "Desarrollo", color: "#7c5cff" },
      { name: "GitHub duplicado", url: "https://github.com", category: "Desarrollo", color: "#000000" },
    ],
  };
  await page.locator("#import-file").setInputFiles({
    name: "respaldo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText(/1 acceso importado; 1 duplicado omitido/)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept("Aprendizaje"));
  await page.getByRole("button", { name: "Renombrar categoría Desarrollo" }).click();
  await expect(page.getByText("La categoría ahora se llama “Aprendizaje”.")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("button", { name: /Aprendizaje/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /MDN/ })).toBeVisible();
});

test("expone el flujo de recuperación de contraseña", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Qué bueno verte" })).toBeVisible();
  await page.getByRole("button", { name: "Olvidé mi contraseña" }).click();
  await expect(page.getByRole("heading", { name: "Recupera tu acceso" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar enlace" })).toBeVisible();
  await page.getByRole("button", { name: "Volver a iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Qué bueno verte" })).toBeVisible();
});

test("no tiene infracciones automáticas de accesibilidad", async ({ page }) => {
  await page.goto("/?preview");
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "Cambiar tema" }).click();
  await page.waitForTimeout(300);
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("no produce desplazamiento horizontal en móvil", async ({ page }) => {
  await page.goto("/?preview");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
