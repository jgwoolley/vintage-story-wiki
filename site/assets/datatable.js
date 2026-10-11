// Client-side search + pagination for large listing blocks. Operates on plain DOM children
// (links, rows, whatever) -- no data fetching, everything is already rendered server-side.
(function () {
  function initDataTable(root) {
    const pageSize = parseInt(root.dataset.pageSize || "50", 10);
    const list = root.querySelector("[data-datatable-items]");
    const searchInput = root.querySelector(".datatable-search");
    const paginationEl = root.querySelector("[data-datatable-pagination]");
    if (!list) return;

    const items = Array.from(list.children);
    let page = 1;

    function matchesQuery(el, query) {
      if (!query) return true;
      // `data-search` lets a row be matched on more than its visible text (e.g. an item's raw
      // code as well as its display name), so a deep link by code still finds the right rows.
      const haystack = `${el.textContent} ${el.dataset.search || ""}`.toLowerCase();
      return haystack.includes(query);
    }

    function render() {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const matches = items.filter((el) => matchesQuery(el, query));
      const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
      if (page > totalPages) page = totalPages;
      if (page < 1) page = 1;

      const start = (page - 1) * pageSize;
      const visible = new Set(matches.slice(start, start + pageSize));
      for (const el of items) {
        el.style.display = visible.has(el) ? "" : "none";
      }

      renderPagination(matches.length, totalPages);
    }

    function renderPagination(count, totalPages) {
      if (!paginationEl) return;
      paginationEl.innerHTML = "";

      const info = document.createElement("span");
      info.className = "datatable-info";
      info.textContent = count === 0 ? "No results" : `${count} result${count === 1 ? "" : "s"} — page ${page} of ${totalPages}`;
      paginationEl.appendChild(info);

      if (totalPages <= 1) return;

      const nav = document.createElement("div");
      nav.className = "datatable-nav";

      const prev = document.createElement("button");
      prev.type = "button";
      prev.textContent = "← Prev";
      prev.disabled = page <= 1;
      prev.addEventListener("click", () => {
        page--;
        render();
        root.scrollIntoView?.({ block: "nearest" });
      });
      nav.appendChild(prev);

      const next = document.createElement("button");
      next.type = "button";
      next.textContent = "Next →";
      next.disabled = page >= totalPages;
      next.addEventListener("click", () => {
        page++;
        render();
        root.scrollIntoView?.({ block: "nearest" });
      });
      nav.appendChild(next);

      paginationEl.appendChild(nav);
    }

    searchInput?.addEventListener("input", () => {
      page = 1;
      render();
    });

    // Lets other pages deep-link into a filtered view, e.g. a recipe linking a wildcard
    // ingredient like "leather-normal-*" to /items/?q=leather-normal- .
    const presetQuery = new URLSearchParams(location.search).get("q");
    if (presetQuery && searchInput) searchInput.value = presetQuery;

    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".datatable").forEach(initDataTable);
  });
})();
