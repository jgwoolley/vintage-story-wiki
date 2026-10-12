// Header "Tools" dropdown: click the toggle to open/close its panel, click outside or Escape to
// close. Same open/close pattern as the datatable filter panels (site/assets/datatable.js), kept
// as a separate tiny script since it's unrelated to any table.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector(".nav-dropdown-toggle");
    const panel = document.querySelector(".nav-dropdown-panel");
    if (!toggle || !panel) return;

    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.addEventListener("click", (e) => {
      if (!panel.hidden && !toggle.contains(e.target) && !panel.contains(e.target)) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  });
})();
