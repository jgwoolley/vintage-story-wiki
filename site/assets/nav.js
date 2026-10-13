// Header dropdowns ("Tools", "Info"): click a toggle to open/close its panel; opening one closes
// any other open panel, and a click outside or Escape closes them all. Same close-others-then-open
// pattern as the datatable filter panels (site/assets/datatable.js), kept as a separate tiny
// script since it's unrelated to any table.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const dropdowns = [...document.querySelectorAll(".nav-dropdown")]
      .map((el) => ({ toggle: el.querySelector(".nav-dropdown-toggle"), panel: el.querySelector(".nav-dropdown-panel") }))
      .filter((d) => d.toggle && d.panel);

    function setOpen(d, open) {
      d.panel.hidden = !open;
      d.toggle.setAttribute("aria-expanded", String(open));
    }
    const closeAll = () => dropdowns.forEach((d) => setOpen(d, false));

    for (const d of dropdowns) {
      d.toggle.addEventListener("click", () => {
        const willOpen = d.panel.hidden;
        closeAll();
        setOpen(d, willOpen);
      });
    }
    document.addEventListener("click", (e) => {
      if (!dropdowns.some((d) => d.toggle.contains(e.target) || d.panel.contains(e.target))) closeAll();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll();
    });
  });
})();
