const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

test("permite buscar y administrar accesos en la vista previa", async ({ page }) => {
  await page.goto("/?preview");
  await expect(page.getByRole("heading", { name: /Jesús/ })).toBeVisible();

  await page.getByLabel("Buscar accesos").fill("GitHub");
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
