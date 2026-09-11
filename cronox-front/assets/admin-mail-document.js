(() => {
  "use strict";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const labels = {
    heading: "Título", text: "Texto", rich: "Texto enriquecido",
    image: "Imagen", button: "Botón", divider: "Separador",
    spacer: "Espacio", columns: "Columnas", section: "Sección",
    logo: "Logo", social: "Enlace social", signature: "Firma",
    video: "Vídeo enlazado", html: "HTML de compatibilidad",
    orderItems: "Artículos del pedido",
    orderTotals: "Resumen del pedido",
    customerDetails: "Datos del cliente",
    trackingDetails: "Seguimiento",
    statusDetails: "Estado del pedido",
  };
  function listAt(documentValue, path) {
    let list = documentValue.blocks;
    for (let index = 0; index < path.length; index += 2) {
      const block = list[path[index]];
      if (!block || !block.columns || !block.columns[path[index + 1]]) return null;
      list = block.columns[path[index + 1]];
    }
    return list;
  }
  function blockAt(documentValue, path) {
    if (!path.length) return null;
    const list = listAt(documentValue, path.slice(0, -1));
    return list ? list[path[path.length - 1]] || null : null;
  }
  function createBlock(type) {
    const common = {
      type: type, padding: 16, align: "left", color: "#202124",
      background: "#ffffff", size: type === "heading" ? 28 : 16,
      weight: type === "heading" ? 700 : 400,
      lineHeight: type === "heading" ? 1.2 : 1.5,
    };
    if (type === "heading") return Object.assign(common, { text: "Escribe un título" });
    if (type === "text") return Object.assign(common, { text: "Escribe aquí" });
    if (type === "rich") return Object.assign(common, { html: "<p>Escribe aquí</p>" });
    if (type === "button") return Object.assign(common, {
      text: "Ver más", url: "https://cronox.es", align: "center",
      buttonBackground: "#111111", buttonColor: "#ffffff", borderRadius: 4,
    });
    if (type === "image" || type === "logo") return Object.assign(common, { src: "", alt: "", width: type === "logo" ? 180 : 560, align: "center" });
    if (type === "divider") return common;
    if (type === "spacer") return Object.assign(common, { size: 32, padding: 0 });
    if (type === "columns") return Object.assign(common, { columns: [[], []] });
    if (type === "section") return Object.assign(common, { padding: 24, columns: [[]] });
    return Object.assign(common, { text: "Escribe aquí" });
  }
  function safeRichNodes(html, ownerDocument) {
    ownerDocument = ownerDocument || document;
    const parsed = new DOMParser().parseFromString(html || "", "text/html");
    const copy = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return ownerDocument.createTextNode(node.textContent || "");
      const tag = node.nodeName.toLowerCase();
      if (["script", "style", "iframe", "svg", "math", "img", "object", "form"].includes(tag)) return ownerDocument.createTextNode("");
      const allowed = ["p", "br", "b", "strong", "i", "em", "u", "a", "span"];
      const result = ownerDocument.createElement(allowed.includes(tag) ? tag : "span");
      const href = node.getAttribute && node.getAttribute("href");
      if (tag === "a" && /^(https?:\/\/|mailto:|tel:)/i.test(href || "")) result.setAttribute("href", href);
      result.append(...Array.from(node.childNodes, copy));
      return result;
    };
    return Array.from(parsed.body.childNodes, copy);
  }
  function moveBlock(documentValue, sourcePath, targetPath) {
    const sourceList = listAt(documentValue, sourcePath.slice(0, -1));
    const targetList = listAt(documentValue, targetPath.slice(0, -1));
    if (!sourceList || !targetList) return false;
    const sourceIndex = sourcePath[sourcePath.length - 1];
    let targetIndex = targetPath[targetPath.length - 1];
    const item = sourceList.splice(sourceIndex, 1)[0];
    if (!item) return false;
    if (sourceList === targetList && sourceIndex < targetIndex) targetIndex -= 1;
    targetList.splice(targetIndex, 0, item);
    return true;
  }
  window.CRONOX_MAIL_DOCUMENT = Object.freeze({
    clone, labels, listAt, blockAt, createBlock, safeRichNodes, moveBlock,
  });
})();
