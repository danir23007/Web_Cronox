// ======================================================
// CRONOX — Mini-galería por producto (soporte < y > dentro de cada tarjeta)
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".product-card").forEach(card => {
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

    // Soporte táctil (swipe en móviles)
    let startX = 0;
    card.addEventListener("touchstart", e => {
      startX = e.touches[0].clientX;
    });
    card.addEventListener("touchend", e => {
      const endX = e.changedTouches[0].clientX;
      const diff = endX - startX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          // swipe derecha
          index = (index - 1 + images.length) % images.length;
        } else {
          // swipe izquierda
          index = (index + 1) % images.length;
        }
        show(index);
      }
    });
  });
});
