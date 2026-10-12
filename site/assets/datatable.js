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
    const controls = root.querySelector(".datatable-controls");
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
    const tagKey = paramKey("tag", instanceIndex);

    // Builds a <select>'s options from whatever `data-*` values are actually present; hides the
    // control entirely only when the page's rows carry no value at all for that dimension (e.g. no
    // row has a mod). A single distinct value still shows the dropdown -- a visible "All mods /
    // game" filter confirms mod/category filtering exists on this page at all, and starts being
    // immediately useful the moment a second mod/category value shows up, with no further changes.
    // `labelAttr`, when given, names a sibling data-* attribute holding a human-readable label for
    // the option text (e.g. `data-mod-label="BetterRuins"` alongside the matching
    // `data-mod="betterruins"`) -- filtering still happens on `attr`'s raw value either way.
    function populateSelect(select, attr, allLabel, labelAttr) {
      if (!select) return [];
      const labelsByValue = new Map();
      for (const el of items) {
        const value = el.dataset[attr];
        if (!value || labelsByValue.has(value)) continue;
        labelsByValue.set(value, (labelAttr && el.dataset[labelAttr]) || value);
      }
      const values = [...labelsByValue.keys()].sort();
      if (values.length < 1) {
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
        opt.textContent = labelsByValue.get(value);
        select.appendChild(opt);
      }
      return values;
    }

    const categoryValues = populateSelect(categorySelect, "category", "All categories");
    const modValues = populateSelect(modSelect, "mod", "All mods", "modLabel");

    // Restore filter state from the URL -- must happen after the <option>s exist, since setting
    // .value to a not-yet-present option is a no-op.
    const initialParams = new URLSearchParams(location.search);
    if (searchInput && initialParams.has(qKey)) searchInput.value = initialParams.get(qKey);
    if (categorySelect && categoryValues.includes(initialParams.get(categoryKey))) categorySelect.value = initialParams.get(categoryKey);
    if (modSelect && modValues.includes(initialParams.get(modKey))) modSelect.value = initialParams.get(modKey);

    // The `tag` param is a separate, exact-token filter against `data-tags` (space-separated),
    // distinct from the free-text `q` substring search -- a tag link (e.g. "predator") shouldn't
    // also match some unrelated row whose display name or code happens to contain "predator" as a
    // substring. There's no fixed small set of tags to populate a <select> from, so instead of a
    // dropdown this renders as a removable chip only when a tag filter is actually active.
    let activeTag = initialParams.get(tagKey) || "";
    let tagChip = null;
    function renderTagChip() {
      if (!controls) return;
      if (!activeTag) {
        tagChip?.remove();
        tagChip = null;
        return;
      }
      if (!tagChip) {
        tagChip = document.createElement("span");
        tagChip.className = "datatable-tag-chip";
        controls.appendChild(tagChip);
      }
      tagChip.textContent = "";
      const label = document.createElement("span");
      label.textContent = `Tag: ${activeTag}`;
      tagChip.appendChild(label);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.setAttribute("aria-label", "Clear tag filter");
      clear.textContent = "×";
      clear.addEventListener("click", () => {
        activeTag = "";
        renderTagChip();
        page = 1;
        render();
      });
      tagChip.appendChild(clear);
    }
    renderTagChip();

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

    function matchesTag(el) {
      if (!activeTag) return true;
      return (el.dataset.tags || "").split(" ").filter(Boolean).includes(activeTag);
    }

    function syncUrl() {
      const params = new URLSearchParams(location.search);
      const setOrDelete = (key, value) => (value ? params.set(key, value) : params.delete(key));
      setOrDelete(qKey, (searchInput?.value || "").trim());
      setOrDelete(categoryKey, categorySelect?.value || "");
      setOrDelete(modKey, modSelect?.value || "");
      setOrDelete(tagKey, activeTag);
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }

    // Column sort: click a <th> to sort the (filtered) rows by that column's cell text, numeric-
    // aware (so e.g. a "Chance" column sorts as numbers, not lexicographically). Not persisted to
    // the URL -- purely a client-side view convenience, reset on reload like pagination already is.
    let sortColIndex = null;
    let sortDir = 1;

    function cellText(el, colIndex) {
      return (el.children[colIndex]?.textContent || "").trim();
    }

    function compareRows(a, b) {
      const av = cellText(a, sortColIndex);
      const bv = cellText(b, sortColIndex);
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      const bothNumeric = !isNaN(an) && !isNaN(bn) && /^-?[\d.]+%?$/.test(av) && /^-?[\d.]+%?$/.test(bv);
      const cmp = bothNumeric ? an - bn : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return cmp * sortDir;
    }

    const headerCells = Array.from(root.querySelectorAll("thead [data-col]"));
    function updateHeaderIndicators() {
      for (const th of headerCells) {
        const active = Number(th.dataset.col) === sortColIndex;
        th.classList.toggle("datatable-sorted", active);
        th.dataset.sortDir = active ? (sortDir === 1 ? "asc" : "desc") : "";
      }
    }
    for (const th of headerCells) {
      th.addEventListener("click", () => {
        const col = Number(th.dataset.col);
        if (sortColIndex === col) {
          // 1st click: ascending. 2nd click (same column): descending. 3rd click: back to unsorted.
          sortDir = sortDir === 1 ? -1 : 0;
          if (sortDir === 0) { sortColIndex = null; sortDir = 1; }
        } else {
          sortColIndex = col;
          sortDir = 1;
        }
        updateHeaderIndicators();
        render();
      });
    }

    function render() {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const matches = items.filter(
        (el) =>
          matchesQuery(el, query) &&
          matchesSelect(el, categorySelect, "category") &&
          matchesSelect(el, modSelect, "mod") &&
          matchesTag(el)
      );
      if (sortColIndex !== null) matches.sort(compareRows);
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
