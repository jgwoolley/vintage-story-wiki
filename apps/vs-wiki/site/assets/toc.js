// A "Contents" box like a wiki's, built from the page's <h2>/<h3> headings when there are enough of them (detail pages with many sections).
// Headings get ids (kept if they already have one), the box goes before the first <h2>, and "hide"/"show" collapses it.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const content = document.querySelector("main.content");
    if (!content) return;
    const headings = [...content.querySelectorAll("h2, h3")].filter((h) => !h.closest(".datatable, details, dialog, .infobox, .card, .coverage-note, .toc"));
    // A detail page (it has an infobox) gets one from three sections; other pages only when they are long.
    if (headings.filter((h) => h.tagName === "H2").length < (content.querySelector(".infobox") ? 3 : 6)) return;
    const used = new Set([...document.querySelectorAll("[id]")].map((el) => el.id));
    for (const h of headings) {
      if (h.id) continue;
      const base = h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      let id = base, n = 2;
      while (used.has(id)) id = `${base}-${n++}`;
      used.add(id);
      h.id = id;
    }
    const box = document.createElement("nav");
    box.className = "toc";
    box.setAttribute("aria-label", "Contents");
    const title = document.createElement("div");
    title.className = "toc-title";
    title.append("Contents ");
    const toggle = Object.assign(document.createElement("button"), { type: "button", className: "toc-toggle", textContent: "hide" });
    title.append(toggle);
    const ol = document.createElement("ol");
    let major = 0, minor = 0, sub = null;
    for (const h of headings) {
      const li = document.createElement("li");
      const a = Object.assign(document.createElement("a"), { href: `#${h.id}` });
      if (h.tagName === "H2") {
        major++;
        minor = 0;
        a.append(Object.assign(document.createElement("span"), { className: "toc-num", textContent: `${major} ` }), h.textContent.trim());
        li.append(a);
        ol.append(li);
        sub = null;
      } else if (major) {
        minor++;
        a.append(Object.assign(document.createElement("span"), { className: "toc-num", textContent: `${major}.${minor} ` }), h.textContent.trim());
        li.append(a);
        if (!sub) {
          sub = document.createElement("ol");
          ol.lastElementChild.append(sub);
        }
        sub.append(li);
      }
    }
    box.append(title, ol);
    toggle.addEventListener("click", () => {
      const hidden = ol.hidden = !ol.hidden;
      toggle.textContent = hidden ? "show" : "hide";
    });
    content.querySelector("h2")?.before(box);
  });
})();
