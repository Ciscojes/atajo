const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const email = process.env.ATAJO_TEST_EMAIL;
const password = process.env.ATAJO_TEST_PASSWORD;
const configSource = readFileSync(resolve(__dirname, "../config.js"), "utf8");
const supabaseUrl = configSource.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const anonKey = configSource.match(/supabaseAnonKey:\s*"([^"]+)"/)?.[1];

test.skip(!email || !password, "Define ATAJO_TEST_EMAIL y ATAJO_TEST_PASSWORD para ejecutar la prueba real.");
if (!supabaseUrl || !anonKey) throw new Error("No se encontró la configuración pública de Supabase.");

test("completa y persiste el flujo principal con Supabase real", async ({ page, request }) => {
  const runId = Date.now();
  const firstName = `Atajo E2E A ${runId}`;
  const editedName = `Atajo E2E A editado ${runId}`;
  const secondName = `Atajo E2E B ${runId}`;
  const category = `E2E ${runId}`;
  const renamedCategory = `Integración ${runId}`;

  const authResponse = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey, "content-type": "application/json" },
    data: { email, password },
  });
  if (!authResponse.ok()) throw new Error(`La cuenta técnica no pudo autenticarse (${authResponse.status()}).`);
  const { access_token: accessToken } = await authResponse.json();
  const apiHeaders = { apikey: anonKey, authorization: `Bearer ${accessToken}` };

  const cleanup = async () => {
    for (const name of [firstName, editedName, secondName]) {
      await request.delete(`${supabaseUrl}/rest/v1/links?name=eq.${encodeURIComponent(name)}`, { headers: apiHeaders });
    }
  };

  const addLink = async (name, url) => {
    await page.getByRole("button", { name: /Nuevo acceso/ }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo acceso" });
    await dialog.getByLabel("Nombre").fill(name);
    await dialog.getByLabel("Dirección web").fill(url);
    await dialog.getByLabel("Categoría").fill(category);
    await dialog.getByRole("button", { name: "Guardar acceso" }).click();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  };

  await cleanup();
  try {
    await page.goto("/");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: /Entrar/ }).click();
    await expect(page.getByRole("button", { name: /Nuevo acceso/ })).toBeVisible();

    await addLink(firstName, "https://example.com/atajo-e2e-a");
    await addLink(secondName, "https://example.com/atajo-e2e-b");

    await page.getByRole("button", { name: `Editar acceso: ${firstName}` }).click();
    await page.getByRole("dialog", { name: "Editar acceso" }).getByLabel("Nombre").fill(editedName);
    await page.getByRole("button", { name: "Guardar acceso" }).click();
    await page.getByRole("button", { name: `Marcar como favorito: ${editedName}` }).click();
    await page.getByRole("button", { name: new RegExp(`Ordenar acceso: ${editedName}`) }).press("ArrowDown");

    await page.getByRole("button", { name: "Administrar colección" }).click();
    page.once("dialog", (dialog) => dialog.accept(renamedCategory));
    await page.getByRole("button", { name: `Renombrar categoría ${category}` }).click();
    await expect(page.getByText(`La categoría ahora se llama “${renamedCategory}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Cerrar" }).click();

    await page.reload();
    await expect(page.getByRole("button", { name: /Nuevo acceso/ })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(renamedCategory) }).click();
    await expect(page.getByRole("link", { name: new RegExp(editedName) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(secondName) })).toBeVisible();
    await expect(page.getByRole("button", { name: `Quitar de favoritos: ${editedName}` })).toBeVisible();
  } finally {
    await cleanup();
  }
});
