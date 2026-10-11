// Client-side search + category/mod filters + pagination for table listings. Operates on plain
// DOM rows (<tr>, whatever) already rendered server-side -- no data fetching. All filter state
// (search text, category, mod) is kept in sync with the URL query string so a filtered view can
// be bookmarked, shared, or revisited with back/forward navigation.
(function () {
  // The 1st datatable on a page uses plain "q"/"category"/"mod"; a 2nd+ one on the same page
  // (e.g. an item page's separate Produced-by/Used-in/Dropped-by tables) gets numbered params
  // ("q2"/"category2"/"mod2", ...) so they don't clobber each other's URL state.
  function paramKey(base, instanceIndex) {
    return instanceIndex === 0 ? base : `${base}${instanceIndex + 1}`;
  }

  function initDataTable(root, instanceIndex) {
    const pageSize = parseInt(root.dataset.pageSize || "50", 10);
    const list = root.querySelector("[data-datatable-items]");
    const searchInput = root.querySelector(".datatable-search");
    const categorySelect = root.querySelector(".datatable-category-filter");
    const modSelect = root.querySelector(".datatable-mod-filter");
    const paginationEl = root.querySelector("[data-datatable-pagination]");
    if (!list) return;

    const items = Array.from(list.children);
    let page = 1;

    const qKey = paramKey("q", instanceIndex);
    const categoryKey = paramKey("category", instanceIndex);
    const modKey = paramKey("mod", instanceIndex);

    // Builds a <select>'s options from whatever `data-*` values are actually present; hides the
    // control entirely when the page's rows don't vary on that dimension (including when there's
    // only one distinct value -- a dropdown with one real choice isn't a useful filter).
    function populateSelect(select, attr, allLabel) {
      if (!select) return [];
      const values = [...new Set(items.map((el) => el.dataset[attr]).filter(Boolean))].sort();
      if (values.length < 2) {
        select.style.display = "none";
        return [];
      }
      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = allLabel;
      select.appendChild(allOption);
      for (const value of values) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
      }
      return values;
    }

    const categoryValues = populateSelect(categorySelect, "category", "All categories");
    const modValues = populateSelect(modSelect, "mod", "All mods");

    // Restore filter state from the URL -- must happen after the <option>s exist, since setting
    // .value to a not-yet-present option is a no-op.
    const initialParams = new URLSearchParams(location.search);
    if (searchInput && initialParams.has(qKey)) searchInput.value = initialParams.get(qKey);
    if (categorySelect && categoryValues.includes(initialParams.get(categoryKey))) categorySelect.value = initialParams.get(categoryKey);
    if (modSelect && modValues.includes(initialParams.get(modKey))) modSelect.value = initialParams.get(modKey);

    function matchesQuery(el, query) {
      if (!query) return true;
      // `data-search` lets a row be matched on more than its visible text (e.g. an item's raw
      // code, or an entity's tags, as well as its display name), so a deep link by code/tag
      // still finds the right rows even though that text isn't necessarily shown in the row.
      const haystack = `${el.textContent} ${el.dataset.search || ""}`.toLowerCase();
      return haystack.includes(query);
    }

    function matchesSelect(el, select, attr) {
      const value = select?.value;
      return !value || el.dataset[attr] === value;
    }

    function syncUrl() {
      const params = new URLSearchParams(location.search);
      const setOrDelete = (key, value) => (value ? params.set(key, value) : params.delete(key));
      setOrDelete(qKey, (searchInput?.value || "").trim());
      setOrDelete(categoryKey, categorySelect?.value || "");
      setOrDelete(modKey, modSelect?.value || "");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }

    function render() {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const matches = items.filter(
        (el) => matchesQuery(el, query) && matchesSelect(el, categorySelect, "category") && matchesSelect(el, modSelect, "mod")
      );
      const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
      if (page > totalPages) page = totalPages;
      if (page < 1) page = 1;

      const start = (page - 1) * pageSize;
      const visible = new Set(matches.slice(start, start + pageSize));
      for (const el of items) {
        el.style.display = visible.has(el) ? "" : "none";
      }

      renderPagination(matches.length, totalPages);
      syncUrl();
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
    categorySelect?.addEventListener("change", () => {
      page = 1;
      render();
    });
    modSelect?.addEventListener("change", () => {
      page = 1;
      render();
    });

    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".datatable").forEach((root, index) => initDataTable(root, index));
  });
})();
