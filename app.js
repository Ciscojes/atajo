const config = window.ATAJO_CONFIG || {};
const previewMode = new URLSearchParams(window.location.search).has("preview");
const configured =
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.startsWith("TU_") &&
  !config.supabaseAnonKey.startsWith("TU_");

const $ = (selector) => document.querySelector(selector);
const state = { mode: "login", user: null, links: [], category: "Todos", query: "" };
let db = null;
let toastTimer = null;

const views = {
  setup: $("#setup-view"),
  auth: $("#auth-view"),
  dashboard: $("#dashboard-view"),
};

function showView(name) {
  Object.entries(views).forEach(([key, element]) => element.classList.toggle("hidden", key !== name));
}

function normalizeError(error) {
  const message = error?.message || "Ocurrió un error inesperado.";
  const translations = [
    [/invalid login credentials/i, "El correo o la contraseña no son correctos."],
    [/email not confirmed/i, "Confirma tu correo antes de iniciar sesión."],
    [/user already registered/i, "Ya existe una cuenta con ese correo."],
    [/password should be at least/i, "La contraseña debe tener al menos 8 caracteres."],
    [/unable to validate email/i, "Escribe una dirección de correo válida."],
    [/failed to fetch/i, "No pudimos conectar con el servidor. Revisa tu conexión."],
  ];
  return translations.find(([pattern]) => pattern.test(message))?.[1] || message;
}

function setMessage(element, message = "", success = false) {
  element.textContent = message;
  element.classList.toggle("hidden", !message);
  element.classList.toggle("success", success);
}

function showToast(message) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("atajo-theme", theme);
  $("#theme-toggle").textContent = theme === "dark" ? "☼" : "☾";
}

function setAuthMode(mode) {
  state.mode = mode;
  const registering = mode === "register";
  const recovering = mode === "forgot";
  const resetting = mode === "reset";
  const login = mode === "login";
  $("#login-tab").classList.toggle("active", login);
  $("#login-tab").setAttribute("aria-selected", String(login));
  $("#register-tab").classList.toggle("active", registering);
  $("#register-tab").setAttribute("aria-selected", String(registering));
  $("#login-tab").disabled = recovering || resetting;
  $("#register-tab").disabled = recovering || resetting;
  $("#name-field").classList.toggle("hidden", !registering);
  $("#email-field").classList.toggle("hidden", resetting);
  $("#password-field").classList.toggle("hidden", recovering);
  $("#name-input").required = registering;
  $("#email-input").required = !resetting;
  $("#password-input").required = !recovering;
  $("#password-input").autocomplete = registering || resetting ? "new-password" : "current-password";
  $("#forgot-password-button").classList.toggle("hidden", !login);
  $("#back-to-login-button").classList.toggle("hidden", !recovering && !resetting);
  const content = {
    login: ["Qué bueno verte", "Ingresa para abrir tu espacio personal.", "Entrar a mi espacio"],
    register: ["Crea tu espacio", "Tus sitios favoritos viajarán contigo.", "Crear mi cuenta"],
    forgot: ["Recupera tu acceso", "Te enviaremos un enlace seguro para elegir una contraseña nueva.", "Enviar enlace"],
    reset: ["Crea una contraseña nueva", "Usa al menos 8 caracteres para proteger tu espacio.", "Guardar contraseña"],
  }[mode];
  $("#auth-title").textContent = content[0];
  $("#auth-subtitle").textContent = content[1];
  $("#auth-submit span:first-child").textContent = content[2];
  setMessage($("#auth-message"));
}

async function handleAuth(event) {
  event.preventDefault();
  const submit = $("#auth-submit");
  const email = $("#email-input").value.trim();
  const password = $("#password-input").value;
  const name = $("#name-input").value.trim();

  setMessage($("#auth-message"));
  submit.disabled = true;

  try {
    if (state.mode === "forgot") {
      const redirectTo = new URL(".", window.location.href).href.split("?")[0].split("#")[0];
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setMessage($("#auth-message"), "Revisa tu correo. Te enviamos un enlace para cambiar la contraseña.", true);
    } else if (state.mode === "reset") {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      await db.auth.signOut();
      setAuthMode("login");
      setMessage($("#auth-message"), "Contraseña actualizada. Ya puedes iniciar sesión.", true);
    } else if (state.mode === "register") {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: new URL(".", window.location.href).href.split("?")[0],
        },
      });
      if (error) throw error;
      if (!data.session) {
        setMessage($("#auth-message"), "Cuenta creada. Revisa tu correo para confirmarla.", true);
        return;
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    setMessage($("#auth-message"), normalizeError(error));
  } finally {
    submit.disabled = false;
  }
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function userName() {
  return state.user?.user_metadata?.display_name?.trim() || state.user?.email?.split("@")[0] || "";
}

function setupUser(user) {
  state.user = user;
  const name = userName();
  $("#welcome-title").textContent = `${greeting()}, ${name} 👋`;
  $("#day-label").textContent = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  $("#user-avatar").textContent = (name[0] || "U").toUpperCase();
  $("#user-email").textContent = user.email;
}

async function loadLinks() {
  $("#loading-state").classList.remove("hidden");
  $("#links-grid").classList.add("hidden");
  $("#empty-state").classList.add("hidden");

  const { data, error } = await db
    .from("links")
    .select("id,name,url,category,color,is_favorite,position,created_at")
    .order("is_favorite", { ascending: false })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  $("#loading-state").classList.add("hidden");
  if (error) {
    $("#loading-state").textContent = normalizeError(error);
    $("#loading-state").classList.remove("hidden");
    return;
  }
  state.links = data || [];
  render();
}

function categories() {
  const counts = state.links.reduce((result, link) => {
    const category = link.category || "Sin categoría";
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {});
  return [
    ["Todos", state.links.length],
    ["Favoritos", state.links.filter((link) => link.is_favorite).length],
    ...Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "es")),
  ];
}

function renderCategories() {
  const nav = $("#category-list");
  const options = $("#category-options");
  nav.replaceChildren();
  options.replaceChildren();

  categories().forEach(([name, count], index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${state.category === name ? " active" : ""}`;
    if (state.category === name) button.setAttribute("aria-current", "page");
    const label = document.createElement("span");
    label.textContent = `${index === 0 ? "⌂" : name === "Favoritos" ? "★" : "◇"}  ${name}`;
    const number = document.createElement("span");
    number.className = "category-count";
    number.textContent = count;
    button.append(label, number);
    button.addEventListener("click", () => {
      state.category = name;
      render();
    });
    nav.append(button);
  });

  [...new Set(state.links.map((link) => link.category).filter(Boolean))].forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    options.append(option);
  });
}

function filteredLinks() {
  const query = state.query.toLocaleLowerCase("es");
  return state.links.filter((link) => {
    const matchesCategory =
      state.category === "Todos" ||
      (state.category === "Favoritos" ? link.is_favorite : (link.category || "Sin categoría") === state.category);
    const matchesQuery = !query || [link.name, link.url, link.category].some((value) => value?.toLocaleLowerCase("es").includes(query));
    return matchesCategory && matchesQuery;
  });
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function makeLinkCard(link) {
  const card = document.createElement("article");
  card.className = "link-card";
  card.style.setProperty("--card-color", link.color || "#7c5cff");

  const top = document.createElement("div");
  top.className = "card-top";
  const icon = document.createElement("span");
  icon.className = "site-icon";
  icon.textContent = link.name.trim().charAt(0).toUpperCase() || "↗";

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = `card-action${link.is_favorite ? " favorite" : ""}`;
  favorite.textContent = link.is_favorite ? "★" : "☆";
  favorite.title = link.is_favorite ? "Quitar de favoritos" : "Marcar como favorito";
  favorite.setAttribute("aria-label", `${favorite.title}: ${link.name}`);
  favorite.addEventListener("click", () => toggleFavorite(link));
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "card-action";
  edit.textContent = "•••";
  edit.title = "Editar acceso";
  edit.setAttribute("aria-label", `Editar acceso: ${link.name}`);
  edit.addEventListener("click", () => openLinkDialog(link));
  actions.append(favorite, edit);
  top.append(icon, actions);

  const anchor = document.createElement("a");
  anchor.className = "link-main";
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  const title = document.createElement("h3");
  title.textContent = link.name;
  const domain = document.createElement("p");
  domain.textContent = safeUrl(link.url)?.hostname.replace(/^www\./, "") || link.url;
  anchor.append(title, domain);

  card.append(top, anchor);
  return card;
}

function render() {
  renderCategories();
  const links = filteredLinks();
  const grid = $("#links-grid");
  grid.replaceChildren(...links.map(makeLinkCard));
  $("#section-title").textContent = state.category === "Todos" ? "Todos los accesos" : state.category;
  $("#section-eyebrow").textContent = state.query ? "Resultados" : "Tu colección";
  $("#link-count").textContent = `${links.length} ${links.length === 1 ? "sitio" : "sitios"}`;
  const empty = links.length === 0;
  grid.classList.toggle("hidden", empty);
  $("#empty-state").classList.toggle("hidden", !empty);
}

function openLinkDialog(link = null) {
  $("#link-form").reset();
  $("#link-id").value = link?.id || "";
  $("#link-name").value = link?.name || "";
  $("#link-url").value = link?.url || "";
  $("#link-category").value = link?.category || "";
  $("#link-color").value = link?.color || "#7c5cff";
  $("#dialog-title").textContent = link ? "Editar acceso" : "Nuevo acceso";
  $("#delete-link-button").classList.toggle("hidden", !link);
  setMessage($("#link-form-message"));
  $("#link-dialog").showModal();
  setTimeout(() => $("#link-name").focus(), 50);
}

async function saveLink(event) {
  event.preventDefault();
  const id = $("#link-id").value;
  const url = safeUrl($("#link-url").value.trim());
  if (!url) {
    setMessage($("#link-form-message"), "Usa una dirección válida que comience con http:// o https://");
    return;
  }

  const payload = {
    name: $("#link-name").value.trim(),
    url: url.href,
    category: $("#link-category").value.trim() || "Sin categoría",
    color: $("#link-color").value,
  };

  if (previewMode) {
    if (id) {
      state.links = state.links.map((link) => link.id === id ? { ...link, ...payload } : link);
    } else {
      state.links.push({
        ...payload,
        id: crypto.randomUUID(),
        is_favorite: false,
        position: state.links.length,
        created_at: new Date().toISOString(),
      });
    }
    $("#link-dialog").close();
    showToast(id ? "Acceso actualizado en la vista previa" : "Acceso agregado a la vista previa");
    render();
    return;
  }

  const query = id
    ? db.from("links").update(payload).eq("id", id)
    : db.from("links").insert({ ...payload, user_id: state.user.id, position: state.links.length });
  const { error } = await query;
  if (error) {
    setMessage($("#link-form-message"), normalizeError(error));
    return;
  }
  $("#link-dialog").close();
  showToast(id ? "Acceso actualizado" : "Acceso agregado");
  await loadLinks();
}

async function toggleFavorite(link) {
  if (previewMode) {
    link.is_favorite = !link.is_favorite;
    render();
    return;
  }
  const { error } = await db.from("links").update({ is_favorite: !link.is_favorite }).eq("id", link.id);
  if (error) return showToast(normalizeError(error));
  await loadLinks();
}

async function deleteLink() {
  const id = $("#link-id").value;
  if (!id || !confirm("¿Eliminar este acceso? Esta acción no se puede deshacer.")) return;
  if (previewMode) {
    state.links = state.links.filter((link) => link.id !== id);
    $("#link-dialog").close();
    showToast("Acceso eliminado de la vista previa");
    render();
    return;
  }
  const { error } = await db.from("links").delete().eq("id", id);
  if (error) return setMessage($("#link-form-message"), normalizeError(error));
  $("#link-dialog").close();
  showToast("Acceso eliminado");
  await loadLinks();
}

function bindEvents() {
  $("#login-tab").addEventListener("click", () => setAuthMode("login"));
  $("#register-tab").addEventListener("click", () => setAuthMode("register"));
  $("#forgot-password-button").addEventListener("click", () => setAuthMode("forgot"));
  $("#back-to-login-button").addEventListener("click", () => setAuthMode("login"));
  $("#auth-form").addEventListener("submit", handleAuth);
  $("#theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#user-menu-button").addEventListener("click", () => {
    const menu = $("#user-menu");
    menu.classList.toggle("hidden");
    $("#user-menu-button").setAttribute("aria-expanded", String(!menu.classList.contains("hidden")));
  });
  document.addEventListener("click", (event) => {
    const wrap = $(".user-menu-wrap");
    if (!wrap.contains(event.target)) {
      $("#user-menu").classList.add("hidden");
      $("#user-menu-button").setAttribute("aria-expanded", "false");
    }
  });
  $("#logout-button").addEventListener("click", () => {
    if (previewMode) return showToast("El cierre de sesión está desactivado en la vista previa");
    db.auth.signOut();
  });
  $("#add-link-button").addEventListener("click", () => openLinkDialog());
  $("#empty-add-button").addEventListener("click", () => openLinkDialog());
  $("#dialog-close").addEventListener("click", () => $("#link-dialog").close());
  $("#dialog-cancel").addEventListener("click", () => $("#link-dialog").close());
  $("#link-form").addEventListener("submit", saveLink);
  $("#delete-link-button").addEventListener("click", deleteLink);
  $("#search-input").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    render();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#search-input").focus();
    }
  });
}

async function init() {
  applyTheme(localStorage.getItem("atajo-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  if (previewMode) {
    bindEvents();
    setupUser({
      id: "preview-user",
      email: "jesus@ejemplo.com",
      user_metadata: { display_name: "Jesús" },
    });
    state.links = [
      { id: "1", name: "Gmail", url: "https://mail.google.com", category: "Trabajo", color: "#e9574f", is_favorite: true, position: 0 },
      { id: "2", name: "GitHub", url: "https://github.com", category: "Desarrollo", color: "#59647a", is_favorite: true, position: 1 },
      { id: "3", name: "YouTube", url: "https://youtube.com", category: "Entretenimiento", color: "#ff3f55", is_favorite: false, position: 2 },
      { id: "4", name: "ChatGPT", url: "https://chatgpt.com", category: "Herramientas", color: "#24a184", is_favorite: true, position: 3 },
      { id: "5", name: "Google Drive", url: "https://drive.google.com", category: "Trabajo", color: "#377cf6", is_favorite: false, position: 4 },
      { id: "6", name: "Spotify", url: "https://open.spotify.com", category: "Entretenimiento", color: "#1dbf64", is_favorite: false, position: 5 },
    ];
    $("#loading-state").classList.add("hidden");
    showView("dashboard");
    render();
    return;
  }
  if (!configured || !window.supabase) {
    showView("setup");
    return;
  }

  db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  bindEvents();
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    setupUser(session.user);
    showView("dashboard");
    await loadLinks();
  } else {
    showView("auth");
  }

  db.auth.onAuthStateChange((event, sessionData) => {
    if (event === "PASSWORD_RECOVERY") {
      setTimeout(() => {
        setAuthMode("reset");
        showView("auth");
        $("#password-input").focus();
      }, 0);
      return;
    }
    if (event === "SIGNED_IN" && sessionData?.user) {
      setTimeout(async () => {
        setupUser(sessionData.user);
        showView("dashboard");
        await loadLinks();
      }, 0);
    }
    if (event === "SIGNED_OUT") {
      setTimeout(() => {
        state.user = null;
        state.links = [];
        $("#auth-form").reset();
        setAuthMode("login");
        showView("auth");
      }, 0);
    }
  });
}

init();

if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
