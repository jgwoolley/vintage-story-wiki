// The sidebar (base.njk): marks the link of the page you are on, and on narrow screens the sidebar is a menu opened by the header's menu button.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const here = location.pathname.replace(/\/index\.html$/, "/");
    const links = [...document.querySelectorAll(".wiki-sidebar a")];
    // The most specific sidebar link that is this page or a parent of it ("/en/items/" for "/en/items/survival/x/"), never the main page for everything.
    let best = null;
    for (const a of links) {
      const path = new URL(a.href, location.href).pathname;
      if (a.target) continue;
      const isMain = a === links[0];
      if (here === path || (!isMain && here.startsWith(path))) if (!best || path.length > new URL(best.href, location.href).pathname.length) best = a;
    }
    best?.classList.add("current");
    best?.setAttribute("aria-current", "page");

    const toggle = document.getElementById("wikiMenuToggle");
    const sidebar = document.getElementById("wikiSidebar");
    toggle?.addEventListener("click", () => {
      const open = !sidebar.classList.contains("open");
      sidebar.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });
  });
})();
