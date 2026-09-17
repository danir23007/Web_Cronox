(function () {
  "use strict";
  const panel = document.getElementById("productOrderPanel");
  const list = document.getElementById("productOrderList");
  const message = document.getElementById("productOrderMessage");
  const save = document.getElementById("productOrderSave");
  const reload = document.getElementById("productOrderReload");
  if (!panel || !list || !save || !reload) return;

  let items = [];
  let initialIds = [];
  let loading = false;
  let saving = false;
  let draggedId = null;
  const setMessage = (text, state = "info") => {
    message.textContent = text;
    message.dataset.state = state;
  };
  const safeImage = (value) =>
    window.CRONOX_SECURITY?.productImageUrl?.(value) || "";
  const dirty = () =>
    JSON.stringify(items.map(({ id }) => id)) !== JSON.stringify(initialIds);

  const move = (id, offset) => {
    if (saving) return;
    const from = items.findIndex((item) => item.id === id);
    const to = Math.max(0, Math.min(items.length - 1, from + offset));
    if (from < 0 || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    render();
    list.children[to]?.querySelector("button")?.focus();
  };

  const render = () => {
    list.replaceChildren();
    items.forEach((item, index) => {
      const row = document.createElement("li");
      row.className = "product-order__item";
      row.draggable = !saving;
      row.dataset.productId = String(item.id);
      row.addEventListener("dragstart", () => {
        draggedId = item.id;
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", () => {
        draggedId = null;
        row.classList.remove("is-dragging");
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = items.findIndex(({ id }) => id === draggedId);
        const to = items.findIndex(({ id }) => id === item.id);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        render();
      });
      const position = document.createElement("span");
      position.className = "product-order__position";
      position.textContent = String(index + 1);
      const image = document.createElement("img");
      image.className = "product-order__image";
      image.alt = "";
      image.src = safeImage(item.images?.[0]?.url || item.imageUrl) || "assets/logo_banner.png";
      const meta = document.createElement("div");
      meta.className = "product-order__meta";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const status = document.createElement("span");
      status.className = "product-order__status";
      status.textContent = item.isActive ? "Activo" : "Inactivo";
      meta.append(name, status);
      const controls = document.createElement("div");
      controls.className = "product-order__moves";
      [["Subir", -1, "↑"], ["Bajar", 1, "↓"]].forEach(([label, offset, symbol]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = symbol;
        button.setAttribute("aria-label", `${label} ${item.name}`);
        button.disabled = saving || (offset === -1 ? index === 0 : index === items.length - 1);
        button.addEventListener("click", () => move(item.id, offset));
        controls.appendChild(button);
      });
      row.append(position, image, meta, controls);
      list.appendChild(row);
    });
    save.disabled = saving || !dirty();
  };

  const load = async () => {
    if (loading || saving) return;
    loading = true;
    save.disabled = true;
    setMessage("Cargando orden…");
    try {
      const payload = await window.CRONOX_API.admin.getProductOrder();
      items = Array.isArray(payload?.items) ? payload.items : [];
      initialIds = items.map(({ id }) => id);
      render();
      setMessage(items.length ? `${items.length} productos cargados.` : "No hay productos.", "success");
    } catch (error) {
      setMessage(error?.message || "No se pudo cargar el orden.", "error");
    } finally {
      loading = false;
    }
  };

  const persist = async () => {
    if (saving || !dirty()) return;
    saving = true;
    render();
    save.textContent = "Guardando…";
    setMessage("Guardando el orden completo…");
    try {
      const ids = items.map(({ id }) => id);
      await window.CRONOX_API.admin.saveProductOrder(ids);
      initialIds = [...ids];
      setMessage("Orden guardado correctamente.", "success");
    } catch (error) {
      setMessage(error?.payload?.message?.code || error?.message || "No se pudo guardar el orden.", "error");
    } finally {
      saving = false;
      save.textContent = "Guardar orden";
      render();
    }
  };

  panel.addEventListener("toggle", () => panel.open && !items.length && load());
  reload.addEventListener("click", load);
  save.addEventListener("click", persist);
})();
