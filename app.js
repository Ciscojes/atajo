const config = window.ATAJO_CONFIG || {};
const previewMode = new URLSearchParams(window.location.search).has("preview");
const configured =
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  !config.supabaseUrl.startsWith("TU_") &&
  !config.supabaseAnonKey.startsWith("TU_");

const $ = (selector) => document.querySelector(selector);
const RESERVED_CATEGORIES = new Set(["todos", "favoritos"]);
const state = { mode: "login", user: null, links: [], category: "Todos", query: "" };
let db = null;
let toastTimer = null;
let draggedLinkId = null;
let reordering = false;

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
    login: ["Accede a tu cuenta", "Usa el correo con el que guardaste tus enlaces.", "Entrar"],
    register: ["Crear una cuenta", "Con tu cuenta puedes sincronizar tus enlaces.", "Crear mi cuenta"],
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
  $("#welcome-title").textContent = `${greeting()}, ${name}`;
  $("#day-label").textContent = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  $("#user-avatar").textContent = (name[0] || "U").toUpperCase();
  $("#user-email").textContent = user.email;
  updateClock();
}

function updateClock() {
  const now = new Date();
  $("#time-label").textContent = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

async function loadLinks() {
  $("#loading-state").classList.remove("hidden");
  $("#links-grid").classList.add("hidden");
  $("#empty-state").classList.add("hidden");

  const { data, error } = await db
    .from("links")
    .select("id,name,url,category,color,is_favorite,position,created_at")
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

  categories().forEach(([name, count]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${state.category === name ? " active" : ""}`;
    if (state.category === name) button.setAttribute("aria-current", "page");
    const label = document.createElement("span");
    label.className = "category-label";
    label.textContent = name;
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

function makeSiteIcon(link, className = "site-icon") {
  const icon = document.createElement("span");
  icon.className = className;
  icon.setAttribute("aria-hidden", "true");
  icon.style.setProperty("--card-color", link.color || "#7c5cff");
  const fallback = document.createElement("span");
  fallback.textContent = link.name.trim().charAt(0).toUpperCase() || "↗";
  icon.append(fallback);
  const url = safeUrl(link.url);
  if (url) {
    const image = document.createElement("img");
    image.src = `${url.origin}/favicon.ico`;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("load", () => icon.classList.add("has-image"));
    image.addEventListener("error", () => image.remove());
    icon.append(image);
  }
  return icon;
}

function isReservedCategory(value) {
  return RESERVED_CATEGORIES.has(value.toLocaleLowerCase("es"));
}

function canReorder() {
  return state.category === "Todos" && !state.query;
}

function normalizePositions() {
  state.links = state.links.map((link, position) => ({ ...link, position }));
}

async function persistOrder() {
  normalizePositions();
  render();
  if (previewMode) {
    showToast("Nuevo orden guardado en la vista previa");
    return;
  }

  reordering = true;
  const results = await Promise.all(
    state.links.map((link) => db.from("links").update({ position: link.position }).eq("id", link.id)),
  );
  const failed = results.find(({ error }) => error);
  reordering = false;
  if (failed) {
    showToast(normalizeError(failed.error));
    await loadLinks();
    return;
  }
  showToast("Orden actualizado");
}

async function moveLink(link, direction) {
  if (!canReorder() || reordering) return;
  const currentIndex = state.links.findIndex(({ id }) => id === link.id);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.links.length) return;
  [state.links[currentIndex], state.links[nextIndex]] = [state.links[nextIndex], state.links[currentIndex]];
  await persistOrder();
}

async function dropLink(sourceId, targetId, placeAfter) {
  if (!sourceId || sourceId === targetId || reordering) return;
  const sourceIndex = state.links.findIndex(({ id }) => id === sourceId);
  if (sourceIndex < 0) return;
  const [moved] = state.links.splice(sourceIndex, 1);
  const targetIndex = state.links.findIndex(({ id }) => id === targetId);
  state.links.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
  await persistOrder();
}

function makeLinkCard(link) {
  const card = document.createElement("article");
  card.className = "link-card";
  card.style.setProperty("--card-color", link.color || "#7c5cff");

  const icon = makeSiteIcon(link);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (canReorder()) {
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "card-action drag-handle";
    dragHandle.textContent = "↕";
    dragHandle.title = "Arrastrar para ordenar";
    dragHandle.setAttribute("aria-label", `Ordenar acceso: ${link.name}. Usa las flechas arriba y abajo.`);
    dragHandle.draggable = true;
    dragHandle.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      moveLink(link, ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1);
    });
    dragHandle.addEventListener("dragstart", (event) => {
      draggedLinkId = link.id;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", link.id);
    });
    dragHandle.addEventListener("dragend", () => {
      draggedLinkId = null;
      document.querySelectorAll(".link-card").forEach((element) => element.classList.remove("dragging", "drag-target"));
    });
    actions.append(dragHandle);
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "card-action move-action";
    moveUp.textContent = "↑";
    moveUp.title = "Mover hacia arriba";
    moveUp.disabled = state.links.findIndex(({ id }) => id === link.id) === 0;
    moveUp.setAttribute("aria-label", `Mover ${link.name} hacia arriba`);
    moveUp.addEventListener("click", () => moveLink(link, -1));
    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "card-action move-action";
    moveDown.textContent = "↓";
    moveDown.title = "Mover hacia abajo";
    moveDown.disabled = state.links.findIndex(({ id }) => id === link.id) === state.links.length - 1;
    moveDown.setAttribute("aria-label", `Mover ${link.name} hacia abajo`);
    moveDown.addEventListener("click", () => moveLink(link, 1));
    actions.append(moveUp, moveDown);
    card.addEventListener("dragover", (event) => {
      if (!draggedLinkId || draggedLinkId === link.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      card.classList.add("drag-target");
    });
    card.addEventListener("dragleave", (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove("drag-target");
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const placeAfter = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      dropLink(draggedLinkId || event.dataTransfer.getData("text/plain"), link.id, placeAfter);
    });
  }
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

  const anchor = document.createElement("a");
  anchor.className = "link-main";
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  const title = document.createElement("h3");
  title.textContent = link.name;
  const domain = document.createElement("p");
  domain.textContent = safeUrl(link.url)?.hostname.replace(/^www\./, "") || link.url;
  const category = document.createElement("span");
  category.className = "card-category";
  category.textContent = link.category || "Sin categoría";
  anchor.append(title, domain, category);

  card.append(icon, anchor, actions);
  return card;
}

function render() {
  renderCategories();
  renderFavorites();
  const links = filteredLinks();
  const grid = $("#links-grid");
  grid.replaceChildren(...links.map(makeLinkCard));
  $("#section-title").textContent = state.category === "Todos" ? "Todos los accesos" : state.category;
  $("#link-count").textContent = `${links.length} ${links.length === 1 ? "sitio" : "sitios"}`;
  const empty = links.length === 0;
  grid.classList.toggle("hidden", empty);
  $("#empty-state").classList.toggle("hidden", !empty);
  if (empty) {
    const filtered = Boolean(state.query || state.category !== "Todos");
    $("#empty-state h3").textContent = filtered ? "Sin resultados" : "Todavía no tienes accesos";
    $("#empty-state p").textContent = filtered ? "Prueba otra búsqueda o categoría." : "Guarda una dirección web para empezar.";
    $("#empty-add-button").textContent = filtered ? "Añadir acceso" : "Crear mi primer acceso";
  }
  const customCategories = new Set(state.links.map((link) => link.category || "Sin categoría"));
  $("#total-stat").textContent = state.links.length;
  $("#favorite-stat").textContent = state.links.filter((link) => link.is_favorite).length;
  $("#category-stat").textContent = customCategories.size;
  $("#sidebar-stat").textContent = `${state.links.length} ${state.links.length === 1 ? "acceso disponible" : "accesos disponibles"}`;
}

function makeFavoriteCard(link) {
  const anchor = document.createElement("a");
  anchor.className = "favorite-card";
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.setProperty("--card-color", link.color || "#7c5cff");
  const icon = makeSiteIcon(link, "favorite-icon");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = link.name;
  const domain = document.createElement("small");
  domain.textContent = safeUrl(link.url)?.hostname.replace(/^www\./, "") || link.url;
  copy.append(name, domain);
  const arrow = document.createElement("span");
  arrow.className = "favorite-arrow";
  arrow.textContent = "↗";
  arrow.setAttribute("aria-hidden", "true");
  anchor.append(icon, copy, arrow);
  return anchor;
}

function renderFavorites() {
  const section = $("#favorites-section");
  const favorites = state.links.filter((link) => link.is_favorite).slice(0, 4);
  const visible = state.category === "Todos" && !state.query && favorites.length > 0;
  section.classList.toggle("hidden", !visible);
  $("#favorites-grid").replaceChildren(...favorites.map(makeFavoriteCard));
}

function renderCategoryManager() {
  const list = $("#category-manager-list");
  list.replaceChildren();
  const managedCategories = [...new Set(state.links.map((link) => link.category || "Sin categoría"))]
    .filter((category) => category !== "Sin categoría")
    .sort((a, b) => a.localeCompare(b, "es"));

  if (!managedCategories.length) {
    const empty = document.createElement("li");
    empty.className = "category-manager-empty";
    empty.textContent = "Todavía no hay categorías personalizadas.";
    list.append(empty);
    return;
  }

  managedCategories.forEach((category) => {
    const item = document.createElement("li");
    item.className = "category-manager-item";
    const name = document.createElement("span");
    name.textContent = category;
    const count = document.createElement("span");
    count.className = "category-manager-count";
    const total = state.links.filter((link) => link.category === category).length;
    count.textContent = `${total} ${total === 1 ? "acceso" : "accesos"}`;
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Renombrar";
    rename.setAttribute("aria-label", `Renombrar categoría ${category}`);
    rename.addEventListener("click", () => renameCategory(category));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Quitar";
    remove.setAttribute("aria-label", `Quitar categoría ${category}`);
    remove.addEventListener("click", () => removeCategory(category));
    item.append(name, count, rename, remove);
    list.append(item);
  });
}

function openCollectionDialog() {
  setMessage($("#collection-message"));
  renderCategoryManager();
  $("#collection-dialog").showModal();
}

async function replaceCategory(previousCategory, nextCategory) {
  if (previewMode) {
    state.links = state.links.map((link) => link.category === previousCategory ? { ...link, category: nextCategory } : link);
  } else {
    const { error } = await db.from("links").update({ category: nextCategory }).eq("category", previousCategory);
    if (error) {
      setMessage($("#collection-message"), normalizeError(error));
      return false;
    }
    state.links = state.links.map((link) => link.category === previousCategory ? { ...link, category: nextCategory } : link);
  }
  if (state.category === previousCategory) state.category = nextCategory;
  render();
  renderCategoryManager();
  return true;
}

async function renameCategory(category) {
  const requestedName = prompt(`Nuevo nombre para “${category}”:`, category);
  if (requestedName === null) return;
  const nextCategory = requestedName.trim();
  if (!nextCategory || nextCategory.length > 40) {
    setMessage($("#collection-message"), "El nombre debe tener entre 1 y 40 caracteres.");
    return;
  }
  if (isReservedCategory(nextCategory)) {
    setMessage($("#collection-message"), `“${nextCategory}” está reservado para la navegación de Atajo.`);
    return;
  }
  if (nextCategory === category) return;
  const updated = await replaceCategory(category, nextCategory);
  if (updated) setMessage($("#collection-message"), `La categoría ahora se llama “${nextCategory}”.`, true);
}

async function removeCategory(category) {
  if (!confirm(`¿Quitar la categoría “${category}”? Sus accesos pasarán a “Sin categoría”.`)) return;
  const updated = await replaceCategory(category, "Sin categoría");
  if (updated) setMessage($("#collection-message"), `Los accesos de “${category}” quedaron sin categoría.`, true);
}

function exportLinks() {
  const backup = {
    format: "atajo-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    links: state.links.map(({ name, url, category, color, is_favorite, position }) => ({
      name,
      url,
      category,
      color,
      is_favorite,
      position,
    })),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `atajo-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
  setMessage($("#collection-message"), `Respaldo creado con ${state.links.length} accesos.`, true);
}

function normalizeImportedLink(candidate, position) {
  if (!candidate || typeof candidate !== "object") return null;
  const name = String(candidate.name || "").trim().slice(0, 80);
  const url = safeUrl(String(candidate.url || "").trim());
  if (!name || !url) return null;
  const rawCategory = String(candidate.category || "Sin categoría").trim();
  const category = (rawCategory && !isReservedCategory(rawCategory) ? rawCategory : "Sin categoría").slice(0, 40);
  const color = /^#[0-9a-f]{6}$/i.test(candidate.color) ? candidate.color : "#7c5cff";
  return {
    name,
    url: url.href,
    category,
    color,
    is_favorite: candidate.is_favorite === true,
    position,
  };
}

async function importLinks(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  setMessage($("#collection-message"));
  try {
    if (file.size > 2_000_000) throw new Error("El respaldo supera el límite de 2 MB.");
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "atajo-backup" || backup?.version !== 1 || !Array.isArray(backup.links)) {
      throw new Error("El archivo no es un respaldo compatible de Atajo.");
    }
    if (backup.links.length > 2000) throw new Error("El respaldo contiene más de 2000 accesos.");

    const existingUrls = new Set(state.links.map((link) => safeUrl(link.url)?.href).filter(Boolean));
    const imported = [];
    let invalid = 0;
    let duplicates = 0;
    backup.links.forEach((candidate) => {
      const link = normalizeImportedLink(candidate, state.links.length + imported.length);
      if (!link) {
        invalid += 1;
      } else if (existingUrls.has(link.url)) {
        duplicates += 1;
      } else {
        existingUrls.add(link.url);
        imported.push(link);
      }
    });

    if (imported.length) {
      if (previewMode) {
        state.links.push(...imported.map((link) => ({ ...link, id: crypto.randomUUID() })));
        render();
      } else {
        const { error } = await db.from("links").insert(imported.map((link) => ({ ...link, user_id: state.user.id })));
        if (error) throw error;
        await loadLinks();
      }
    }
    renderCategoryManager();
    const details = [
      `${imported.length} ${imported.length === 1 ? "acceso importado" : "accesos importados"}`,
      duplicates ? `${duplicates} ${duplicates === 1 ? "duplicado omitido" : "duplicados omitidos"}` : "",
      invalid ? `${invalid} ${invalid === 1 ? "entrada inválida omitida" : "entradas inválidas omitidas"}` : "",
    ].filter(Boolean).join("; ");
    setMessage($("#collection-message"), `${details}.`, true);
  } catch (error) {
    setMessage($("#collection-message"), normalizeError(error));
  } finally {
    input.value = "";
  }
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

  const category = $("#link-category").value.trim() || "Sin categoría";
  if (isReservedCategory(category)) {
    setMessage($("#link-form-message"), `“${category}” está reservado para la navegación de Atajo.`);
    return;
  }

  const payload = {
    name: $("#link-name").value.trim(),
    url: url.href,
    category,
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
  $("#collection-tools-button").addEventListener("click", openCollectionDialog);
  $("#sidebar-add-button").addEventListener("click", () => openLinkDialog());
  $("#collection-dialog-close").addEventListener("click", () => $("#collection-dialog").close());
  $("#export-links-button").addEventListener("click", exportLinks);
  $("#import-file").addEventListener("change", importLinks);
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
      { id: "4", name: "ChatGPT", url: "https://chatgpt.com", category: "Herramientas", color: "#50749e", is_favorite: true, position: 3 },
      { id: "5", name: "Google Drive", url: "https://drive.google.com", category: "Trabajo", color: "#377cf6", is_favorite: false, position: 4 },
      { id: "6", name: "Spotify", url: "https://open.spotify.com", category: "Entretenimiento", color: "#64738c", is_favorite: false, position: 5 },
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

setInterval(updateClock, 30_000);

if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
