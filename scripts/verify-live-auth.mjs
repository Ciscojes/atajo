import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

if (process.env.ATAJO_RUN_LIVE_TESTS !== "1") {
  console.error("Define ATAJO_RUN_LIVE_TESTS=1 para crear las cuentas técnicas y ejecutar esta prueba.");
  process.exit(1);
}

const publicUrl = process.env.ATAJO_PUBLIC_URL || "https://ciscojes.github.io/atajo/";
const configSource = await readFile(new URL("../config.js", import.meta.url), "utf8");
const supabaseUrl = configSource.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const anonKey = configSource.match(/supabaseAnonKey:\s*"([^"]+)"/)?.[1];
let redirectsAreConfigured = true;

if (!supabaseUrl || !anonKey) throw new Error("No se encontró la configuración pública de Supabase.");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const request = async (url, options = {}) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, options);
    const body = await response.text();
    let data = body;
    try { data = body ? JSON.parse(body) : null; } catch {}
    if (response.status === 429 && attempt < 5) {
      await delay((attempt + 1) * 3000);
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
    return { response, data };
  }
};

async function createMailbox(domain) {
  const suffix = randomBytes(8).toString("hex");
  const address = `atajo-e2e-${suffix}@${domain}`;
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  await request("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  const { data } = await request("https://api.mail.tm/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  return { address, password, token: data.token };
}

async function waitForMessage(mailbox, ignoredIds = new Set()) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data } = await request("https://api.mail.tm/messages?page=1", {
      headers: { authorization: `Bearer ${mailbox.token}` },
    });
    const message = data["hydra:member"].find((item) => !ignoredIds.has(item.id));
    if (message) {
      const detail = await request(`https://api.mail.tm/messages/${message.id}`, {
        headers: { authorization: `Bearer ${mailbox.token}` },
      });
      return detail.data;
    }
    await delay(2000);
  }
  throw new Error("El correo de Supabase no llegó dentro del tiempo esperado.");
}

function confirmationUrl(message) {
  const source = [message.html, message.text].flat().filter(Boolean).join("\n").replaceAll("&amp;", "&");
  const links = source.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return links.find((link) => link.includes("/auth/v1/verify"));
}

async function createConfirmedUser(mailbox, label) {
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  const signup = await request(`${supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(publicUrl)}`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: mailbox.address, password, data: { display_name: label }, gotrue_meta_security: {} }),
  });
  const message = await waitForMessage(mailbox);
  const verifyUrl = confirmationUrl(message);
  if (!verifyUrl) throw new Error("No se encontró el enlace de confirmación.");
  const verification = await fetch(verifyUrl, { redirect: "manual" });
  const location = verification.headers.get("location");
  if (!location?.startsWith(publicUrl)) {
    redirectsAreConfigured = false;
    console.warn(`Aviso: Supabase aún no autoriza ${publicUrl}.`);
  }
  const fragment = new URL(location).hash.slice(1);
  const token = new URLSearchParams(fragment).get("access_token");
  if (!token) throw new Error("La confirmación no devolvió una sesión válida.");
  return { id: signup.data.user.id, email: mailbox.address, password, token, confirmationMessageId: message.id };
}

const domains = await request("https://api.mail.tm/domains?page=1");
const domain = domains.data["hydra:member"].find((item) => item.isActive)?.domain;
if (!domain) throw new Error("No hay un dominio temporal disponible.");

console.log("1/5 Creando buzones técnicos temporales…");
const mailboxA = await createMailbox(domain);
await delay(3000);
const mailboxB = await createMailbox(domain);
console.log("2/5 Registrando y confirmando dos usuarios…");
const [userA, userB] = await Promise.all([
  createConfirmedUser(mailboxA, "Prueba A"),
  createConfirmedUser(mailboxB, "Prueba B"),
]);

const authHeaders = (token) => ({ apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" });
console.log("3/5 Creando un acceso privado con el usuario A…");
const created = await request(`${supabaseUrl}/rest/v1/links?select=id,name`, {
  method: "POST",
  headers: { ...authHeaders(userA.token), prefer: "return=representation" },
  body: JSON.stringify({ user_id: userA.id, name: "Atajo RLS Test", url: "https://example.com", category: "Pruebas", color: "#7c5cff" }),
});
const linkId = created.data[0]?.id;
if (!linkId) throw new Error("No se pudo crear el acceso de prueba.");

console.log("4/5 Verificando aislamiento entre usuarios…");
const invisible = await request(`${supabaseUrl}/rest/v1/links?id=eq.${linkId}&select=id`, { headers: authHeaders(userB.token) });
if (invisible.data.length !== 0) throw new Error("RLS permitió al usuario B leer datos del usuario A.");
const update = await request(`${supabaseUrl}/rest/v1/links?id=eq.${linkId}&select=id`, {
  method: "PATCH",
  headers: { ...authHeaders(userB.token), prefer: "return=representation" },
  body: JSON.stringify({ name: "Intento no autorizado" }),
});
if (update.data.length !== 0) throw new Error("RLS permitió al usuario B editar datos del usuario A.");
const deletion = await request(`${supabaseUrl}/rest/v1/links?id=eq.${linkId}&select=id`, {
  method: "DELETE",
  headers: { ...authHeaders(userB.token), prefer: "return=representation" },
});
if (deletion.data.length !== 0) throw new Error("RLS permitió al usuario B borrar datos del usuario A.");

console.log("5/5 Probando recuperación y limpiando el acceso de prueba…");
await request(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(publicUrl)}`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email: userA.email }),
});
const recoveryMessage = await waitForMessage(mailboxA, new Set([userA.confirmationMessageId]));
if (!confirmationUrl(recoveryMessage)) throw new Error("El correo de recuperación no contiene un enlace válido.");
await request(`${supabaseUrl}/rest/v1/links?id=eq.${linkId}`, { method: "DELETE", headers: authHeaders(userA.token) });

if (!redirectsAreConfigured) {
  console.error(`CRUD, correo y RLS funcionan, pero falta autorizar ${publicUrl} en Supabase Auth.`);
  process.exitCode = 2;
} else {
  console.log("Verificación completa: correo, redirección pública, CRUD y aislamiento RLS funcionan.");
}
