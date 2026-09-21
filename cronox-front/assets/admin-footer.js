(function () {
  "use strict";

  const section = document.getElementById("section-footer");
  const form = document.getElementById("footerSettingsForm");
  const save = document.getElementById("footerSettingsSave");
  const status = document.getElementById("footerSettingsStatus");
  const pageList = document.getElementById("footerPageList");
  const pageEditor = document.getElementById("footerPageEditor");
  const pageContent = document.getElementById("footerPageContent");
  const pageTitle = document.getElementById("footerPageEditorTitle");
  const pageRoute = document.getElementById("footerPageEditorRoute");
  const pageBack = document.getElementById("footerPageBack");
  const pageSave = document.getElementById("footerPageSave");
  if (!section || !form || !save || !status) return;

  const fields = Array.from(form.elements).filter((element) => element.name);
  let revision = 0;
  let loading = false;
  let saving = false;
  let loaded = false;
  let selectedPage = null;
  let pageRevision = 0;
  let pageSaving = false;

  const base = () =>
    String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
  const message = (text, state = "info") => {
    status.textContent = text;
    status.dataset.state = state;
  };
  const parse = async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        Array.isArray(payload.message)
          ? payload.message.join(" ")
          : payload.message || `Error del servidor (${response.status})`,
      );
    }
    return payload;
  };
  const fill = (settings) => {
    fields.forEach((field) => {
      field.value =
        typeof settings[field.name] === "string" ? settings[field.name] : "";
    });
    revision = Number(settings.revision) || 0;
  };
  const request = async (path, options = {}) => {
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (method !== "GET") {
      Object.assign(headers, await window.CRONOX_API.getCsrfHeaders());
    }
    const response = await fetch(`${base()}${path}`, {
      ...options,
      method,
      headers,
      credentials: "include",
      cache: method === "GET" ? "no-store" : undefined,
    });
    return parse(response);
  };
  const load = async (force = false) => {
    if ((loaded && !force) || loading) return;
    loading = true;
    message("Cargando configuración…");
    try {
      const response = await fetch(`${base()}/api/admin/footer`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      fill(await parse(response));
      loaded = true;
      message("Configuración del footer cargada.", "success");
    } catch (error) {
      message(error.message || "No se pudo cargar el footer.", "error");
    } finally {
      loading = false;
    }
  };
  const saveSettings = async () => {
    if (saving) return;
    const payload = { expectedRevision: revision };
    for (const field of fields) {
      const value = field.value.trim();
      if (!value) {
        message("Todos los campos son obligatorios.", "error");
        field.focus();
        return;
      }
      if (field.type === "url") {
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch {
          message(
            "Las redes sociales requieren URLs http o https válidas.",
            "error",
          );
          field.focus();
          return;
        }
      }
      payload[field.name] = value;
    }
    saving = true;
    save.disabled = true;
    save.textContent = "Guardando…";
    message("Guardando cambios…");
    try {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(await window.CRONOX_API.getCsrfHeaders()),
      };
      const response = await fetch(`${base()}/api/admin/footer`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify(payload),
      });
      fill(await parse(response));
      message("Footer actualizado correctamente.", "success");
    } catch (error) {
      message(error.message || "No se pudo guardar el footer.", "error");
    } finally {
      saving = false;
      save.disabled = false;
      save.textContent = "Guardar cambios";
    }
  };

  const staticPageContent = async (sourceFile) => {
    const response = await fetch(sourceFile, { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el contenido actual.");
    const source = await response.text();
    const parsed = new DOMParser().parseFromString(source, "text/html");
    const content = parsed.querySelector("[data-footer-content]");
    if (!content) throw new Error("La página no contiene una zona editable.");
    return content.innerHTML.trim();
  };

  const openPage = async (button) => {
    if (!button || pageSaving) return;
    selectedPage = {
      slug: button.dataset.footerPage,
      path: button.dataset.publicPath,
      sourceFile: button.dataset.sourceFile,
      label: button.textContent.trim(),
    };
    pageList.hidden = true;
    form.hidden = true;
    pageEditor.hidden = false;
    pageTitle.textContent = selectedPage.label;
    pageRoute.textContent = selectedPage.path;
    pageContent.setAttribute("aria-busy", "true");
    pageContent.innerHTML = "<p>Cargando contenido…</p>";
    message(`Cargando ${selectedPage.label}…`);
    try {
      const stored = await request(
        `/api/admin/footer/pages/${encodeURIComponent(selectedPage.slug)}`,
      );
      pageRevision = Number(stored.revision) || 0;
      pageContent.innerHTML =
        typeof stored.html === "string" && stored.html.trim()
          ? stored.html
          : await staticPageContent(selectedPage.sourceFile);
      message(`${selectedPage.label} cargada.`, "success");
    } catch (error) {
      pageContent.innerHTML = "";
      message(error.message || "No se pudo cargar la página.", "error");
    } finally {
      pageContent.removeAttribute("aria-busy");
    }
  };

  const closePage = () => {
    if (pageSaving) return;
    selectedPage = null;
    pageEditor.hidden = true;
    pageList.hidden = false;
    form.hidden = false;
    message("Selecciona una página o edita las redes sociales.");
  };

  const savePage = async () => {
    if (!selectedPage || pageSaving) return;
    const html = pageContent.innerHTML.trim();
    if (!html || !pageContent.querySelector("h1")) {
      message("La página debe conservar un título principal y contenido.", "error");
      pageContent.focus();
      return;
    }
    pageSaving = true;
    pageSave.disabled = true;
    pageSave.textContent = "Guardando…";
    message(`Guardando ${selectedPage.label}…`);
    try {
      const saved = await request(
        `/api/admin/footer/pages/${encodeURIComponent(selectedPage.slug)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html, expectedRevision: pageRevision }),
        },
      );
      pageRevision = Number(saved.revision) || pageRevision + 1;
      pageContent.innerHTML = saved.html;
      message(`${selectedPage.label} actualizada correctamente.`, "success");
    } catch (error) {
      message(error.message || "No se pudo guardar la página.", "error");
    } finally {
      pageSaving = false;
      pageSave.disabled = false;
      pageSave.textContent = "Guardar cambios";
    }
  };

  save.addEventListener("click", saveSettings);
  pageList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-footer-page]");
    if (button) void openPage(button);
  });
  pageBack.addEventListener("click", closePage);
  pageSave.addEventListener("click", savePage);
  section.querySelector(".footer-page-editor__toolbar")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-content-command]");
    if (!button) return;
    pageContent.focus();
    const command = button.dataset.contentCommand;
    let value = button.dataset.contentValue || null;
    if (command === "createLink") {
      const url = window.prompt("URL http(s), correo o ruta interna:");
      if (!url) return;
      if (!/^(?:https?:\/\/|mailto:|\/)/i.test(url)) {
        message("El enlace debe ser http(s), mailto o una ruta interna.", "error");
        return;
      }
      value = url;
    }
    document.execCommand(command, false, value);
  });
  document
    .querySelectorAll('[data-nav-target="section-footer"]')
    .forEach((button) => button.addEventListener("click", () => void load()));
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#section-footer") void load();
  });
  if (window.location.hash === "#section-footer") void load();
  window.CRONOX_ADMIN_FOOTER = { load, save: saveSettings, openPage, savePage };
})();
