import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

if (process.env.ATAJO_CREATE_TEST_USER !== "1") {
  throw new Error("Ejecuta este script mediante npm run test:live:setup.");
}

try {
  await access(new URL("../.env.local", import.meta.url));
  throw new Error(".env.local ya existe. No se sobrescribió la cuenta técnica configurada.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const configSource = await readFile(new URL("../config.js", import.meta.url), "utf8");
const supabaseUrl = configSource.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const anonKey = configSource.match(/supabaseAnonKey:\s*"([^"]+)"/)?.[1];
const publicUrl = "https://ciscojes.github.io/atajo/";
if (!supabaseUrl || !anonKey) throw new Error("No se encontró la configuración pública de Supabase.");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const request = async (url, options = {}) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (response.status === 429 && attempt < 5) {
      await delay((attempt + 1) * 3000);
      continue;
    }
    if (!response.ok) throw new Error(`La solicitud técnica falló (${response.status}).`);
    return { response, data };
  }
};

const domains = await request("https://api.mail.tm/domains?page=1");
const domain = domains.data["hydra:member"].find((item) => item.isActive)?.domain;
if (!domain) throw new Error("No hay un dominio temporal disponible.");

const suffix = randomBytes(8).toString("hex");
const email = `atajo-e2e-${suffix}@${domain}`;
const mailboxPassword = `${randomBytes(18).toString("base64url")}Aa1!`;
const password = `${randomBytes(24).toString("base64url")}Aa1!`;

console.log("1/4 Creando el buzón técnico temporal…");
await request("https://api.mail.tm/accounts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: email, password: mailboxPassword }),
});
const mailboxAuth = await request("https://api.mail.tm/token", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: email, password: mailboxPassword }),
});

console.log("2/4 Registrando la cuenta dedicada en Supabase…");
await request(`${supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(publicUrl)}`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email, password, data: { display_name: "Pruebas Atajo" }, gotrue_meta_security: {} }),
});

console.log("3/4 Esperando y confirmando el correo…");
let confirmationLink = null;
for (let attempt = 0; attempt < 30 && !confirmationLink; attempt += 1) {
  const messages = await request("https://api.mail.tm/messages?page=1", {
    headers: { authorization: `Bearer ${mailboxAuth.data.token}` },
  });
  const message = messages.data["hydra:member"][0];
  if (message) {
    const detail = await request(`https://api.mail.tm/messages/${message.id}`, {
      headers: { authorization: `Bearer ${mailboxAuth.data.token}` },
    });
    const source = [detail.data.html, detail.data.text].flat().filter(Boolean).join("\n").replaceAll("&amp;", "&");
    confirmationLink = (source.match(/https?:\/\/[^\s"'<>]+/g) || []).find((link) => link.includes("/auth/v1/verify"));
  }
  if (!confirmationLink) await delay(2000);
}
if (!confirmationLink) throw new Error("El correo de confirmación no llegó a tiempo.");
await fetch(confirmationLink, { redirect: "manual" });

const login = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.data.access_token) throw new Error("La cuenta técnica no quedó confirmada.");

console.log("4/4 Guardando las credenciales únicamente en .env.local…");
await writeFile(
  new URL("../.env.local", import.meta.url),
  `ATAJO_TEST_EMAIL=${email}\nATAJO_TEST_PASSWORD=${password}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log("Cuenta técnica lista. Las credenciales no se mostraron ni se añadieron a Git.");
