(() => {
  "use strict";

  const bind = () => Array.from(
    document.querySelectorAll(".faq-item button[aria-controls]"),
  ).forEach((button) => {
    if (button.dataset.faqBound === "1") return;
    const answer = document.getElementById(
      button.getAttribute("aria-controls"),
    );
    if (!answer) return;
    button.dataset.faqBound = "1";
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      answer.hidden = expanded;
      const indicator = button.querySelector('[aria-hidden="true"]');
      if (indicator) indicator.textContent = expanded ? "+" : "−";
    });
  });
  bind();
  document.addEventListener("cronox:page-content-applied", bind);
})();
