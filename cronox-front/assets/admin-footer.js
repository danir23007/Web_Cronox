(function () {
  "use strict";

  const section = document.getElementById("section-footer");
  const form = document.getElementById("footerSettingsForm");
  const save = document.getElementById("footerSettingsSave");
  const status = document.getElementById("footerSettingsStatus");
  if (!section || !form || !save || !status) return;

  const fields = Array.from(form.elements).filter((element) => element.name);
  let revision = 0;
  let loading = false;
  let saving = false;
  let loaded = false;

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

  save.addEventListener("click", saveSettings);
  document
    .querySelectorAll('[data-nav-target="section-footer"]')
    .forEach((button) => button.addEventListener("click", () => void load()));
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#section-footer") void load();
  });
  if (window.location.hash === "#section-footer") void load();
  window.CRONOX_ADMIN_FOOTER = { load, save: saveSettings };
})();
