(() => {
  "use strict";

  const buttons = Array.from(
    document.querySelectorAll(".faq-item button[aria-controls]"),
  );
  buttons.forEach((button) => {
    const answer = document.getElementById(
      button.getAttribute("aria-controls"),
    );
    if (!answer) return;
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      answer.hidden = expanded;
      const indicator = button.querySelector('[aria-hidden="true"]');
      if (indicator) indicator.textContent = expanded ? "+" : "−";
    });
  });
})();
