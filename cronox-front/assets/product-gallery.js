// ======================================================
// CRONOX — Mini-galería por producto (soporte < y > dentro de cada tarjeta)
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".product-card").forEach(card => {
    if (card.dataset.cardGalleryBound === "true") return;
    const images = card.querySelectorAll(".product-img");
    const prev = card.querySelector(".product-arrow.prev");
    const next = card.querySelector(".product-arrow.next");
    if (!images.length || !prev || !next) return;

    let index = 0;

    function show(i) {
      images.forEach((img, j) => img.classList.toggle("active", j === i));
    }

    prev.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      index = (index - 1 + images.length) % images.length;
      show(index);
    });

    next.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      index = (index + 1) % images.length;
      show(index);
    });

    card.dataset.cardGalleryBound = "true";
  });
});
