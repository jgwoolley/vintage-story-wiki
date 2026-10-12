// Client-side search + category/mod/tag multi-select filters + column sort + pagination for
// table listings. Operates on plain DOM rows (<tr>, whatever) already rendered server-side -- no
// data fetching. All of search/filters/sort (search text, the active values in each of the three
// filter dimensions, and the sorted column + direction) are kept in sync with the URL query
// string so a filtered/sorted view can be bookmarked, shared, or revisited with back/forward
// navigation. Pagination alone stays client-only, reset on reload.
(function () {
  // The 1st datatable on a page uses plain "q"/"category"/"mod"/"tag"; a 2nd+ one on the same page
  // (e.g. an item page's separate Produced-by/Used-in/Dropped-by tables) gets numbered params
  // ("q2"/"category2"/"mod2"/"tag2", ...) so they don't clobber each other's URL state.
  function paramKey(base, instanceIndex) {
    return instanceIndex === 0 ? base : `${base}${instanceIndex + 1}`;
  }

  // Every open filter panel on the page, across every datatable instance, so a single top-level
  // click/Escape handler can close whichever one(s) are open without each instance needing its own
  // listener.
  const allDimensions = [];

  function initDataTable(root, instanceIndex) {
    const pageSize = parseInt(root.dataset.pageSize || "50", 10);
    const list = root.querySelector("[data-datatable-items]");
    const activeFiltersEl = root.querySelector("[data-datatable-active-filters]");
    const searchInput = root.querySelector(".datatable-search");
    const paginationEl = root.querySelector("[data-datatable-pagination]");
    if (!list) return;

    const items = Array.from(list.children);
    let page = 1;

    const qKey = paramKey("q", instanceIndex);

    // Collects the distinct values present across all rows for one filter dimension, mapped to
    // their display label. `multiToken` (tags only) splits each row's attribute on whitespace
    // first, since a row can carry several tags at once; `labelAttr` (mod only) names a sibling
    // data-* attribute holding a human-readable label (e.g. `data-mod-label="BetterRuins"`
    // alongside the matching `data-mod="betterruins"`) -- filtering still happens on the raw value
    // either way.
    function collectValues(attr, labelAttr, multiToken) {
      const labelsByValue = new Map();
      for (const el of items) {
        const raw = el.dataset[attr];
        if (!raw) continue;
        const tokens = multiToken ? raw.split(" ").filter(Boolean) : [raw];
        for (const value of tokens) {
          if (!value || labelsByValue.has(value)) continue;
          labelsByValue.set(value, (!multiToken && labelAttr && el.dataset[labelAttr]) || value);
        }
      }
      return labelsByValue;
    }

    // Builds one filter dimension: populates its checkbox panel from whatever values are actually
    // present, hides the whole button+panel widget if there are none at all (a single distinct
    // value still shows it -- see the macro's doc comment), and wires up checkbox change events.
    function buildDimension(name, attr, label, labelAttr, multiToken) {
      const wrapper = root.querySelector(`.datatable-filter[data-filter-dimension="${name}"]`);
      const toggle = wrapper ? wrapper.querySelector(".datatable-filter-toggle") : null;
      const panel = wrapper ? wrapper.querySelector(".datatable-filter-panel") : null;
      const labelsByValue = collectValues(attr, labelAttr, multiToken);
      const values = [...labelsByValue.keys()].sort();
      const dim = {
        name,
        attr,
        label,
        multiToken,
        wrapper,
        toggle,
        panel,
        labelsByValue,
        values,
        active: new Set(),
        key: paramKey(name, instanceIndex),
        checkboxes: new Map(),
      };

      if (!wrapper || !toggle || !panel || values.length < 1) {
        if (wrapper) wrapper.style.display = "none";
        return dim;
      }

      for (const value of values) {
        const optionLabel = document.createElement("label");
        optionLabel.className = "datatable-filter-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = value;
        const text = document.createElement("span");
        text.textContent = labelsByValue.get(value);
        optionLabel.appendChild(checkbox);
        optionLabel.appendChild(text);
        panel.appendChild(optionLabel);
        dim.checkboxes.set(value, checkbox);
      }

      return dim;
    }

    const dimensions = [
      buildDimension("category", "category", "Category", null, false),
      buildDimension("mod", "mod", "Mod", "modLabel", false),
      buildDimension("tag", "tags", "Tags", null, true),
    ];
    allDimensions.push(...dimensions);

    // Restore filter state from the URL -- values are comma-separated (`?category=rock,ore`) and
    // filtered against the known value set so a stale/garbage param can't silently match zero rows
    // forever. Must happen after the checkboxes exist, since checking a not-yet-present one is a
    // no-op.
    const initialParams = new URLSearchParams(location.search);
    if (searchInput && initialParams.has(qKey)) searchInput.value = initialParams.get(qKey);
    for (const dim of dimensions) {
      const raw = initialParams.get(dim.key);
      if (!raw) continue;
      for (const value of raw.split(",").map((v) => v.trim()).filter(Boolean)) {
        if (dim.checkboxes.has(value)) {
          dim.active.add(value);
          dim.checkboxes.get(value).checked = true;
        }
      }
    }

    function updateToggleLabel(dim) {
      if (!dim.toggle) return;
      dim.toggle.textContent = dim.active.size ? `${dim.label} (${dim.active.size})` : dim.label;
    }

    // Every active value across all three dimensions, regardless of which one, shown as a
    // removable chip -- reuses the same visual style the old single-value tag chip used.
    function renderActiveChips() {
      if (!activeFiltersEl) return;
      activeFiltersEl.innerHTML = "";
      for (const dim of dimensions) {
        for (const value of dim.active) {
          const chip = document.createElement("span");
          chip.className = "datatable-chip";
          const text = document.createElement("span");
          text.textContent = `${dim.label}: ${dim.labelsByValue.get(value) || value}`;
          chip.appendChild(text);
          const clear = document.createElement("button");
          clear.type = "button";
          clear.setAttribute("aria-label", `Remove ${dim.label} filter: ${value}`);
          clear.textContent = "×";
          clear.addEventListener("click", () => {
            dim.active.delete(value);
            const cb = dim.checkboxes.get(value);
            if (cb) cb.checked = false;
            updateToggleLabel(dim);
            page = 1;
            render();
          });
          chip.appendChild(clear);
          activeFiltersEl.appendChild(chip);
        }
      }
    }

    for (const dim of dimensions) {
      updateToggleLabel(dim);
      if (!dim.toggle || !dim.panel) continue;
      dim.toggle.addEventListener("click", () => {
        // Only one filter panel open at a time, across every dimension on every datatable on the
        // page -- close everything else first, then open this one (or leave it closed, if it was
        // the one already open, i.e. a plain toggle-closed).
        const opening = dim.panel.hidden;
        for (const d of allDimensions) {
          if (d.panel) d.panel.hidden = true;
          d.toggle?.setAttribute("aria-expanded", "false");
        }
        if (opening) {
          dim.panel.hidden = false;
          dim.toggle.setAttribute("aria-expanded", "true");
        }
      });
      for (const [value, checkbox] of dim.checkboxes) {
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) dim.active.add(value);
          else dim.active.delete(value);
          updateToggleLabel(dim);
          page = 1;
          render();
        });
      }
    }

    function matchesQuery(el, query) {
      if (!query) return true;
      // `data-search` lets a row be matched on more than its visible text (e.g. an item's raw
      // code, or an entity's tags, as well as its display name), so a deep link by code/tag
      // still finds the right rows even though that text isn't necessarily shown in the row.
      const haystack = `${el.textContent} ${el.dataset.search || ""}`.toLowerCase();
      return haystack.includes(query);
    }

    // OR within one dimension (any checked value matches); the caller ANDs this across all
    // dimensions plus the free-text search.
    function matchesDimension(el, dim) {
      if (dim.active.size === 0) return true;
      if (dim.multiToken) {
        const tokens = (el.dataset[dim.attr] || "").split(" ").filter(Boolean);
        return tokens.some((t) => dim.active.has(t));
      }
      return dim.active.has(el.dataset[dim.attr]);
    }

    function syncUrl() {
      const params = new URLSearchParams(location.search);
      const setOrDelete = (key, value) => (value ? params.set(key, value) : params.delete(key));
      setOrDelete(qKey, (searchInput?.value || "").trim());
      for (const dim of dimensions) {
        setOrDelete(dim.key, [...dim.active].join(","));
      }
      setOrDelete(sortKey, sortColIndex !== null ? String(sortColIndex) : "");
      setOrDelete(dirKey, sortColIndex !== null ? (sortDir === 1 ? "asc" : "desc") : "");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }

    // Column sort: click a <th> to sort the (filtered) rows by that column's cell text, numeric-
    // aware (so e.g. a "Chance" column sorts as numbers, not lexicographically). Persisted to the
    // URL the same way the filters are (`?sort=<colIndex>&dir=asc|desc`, numbered `sort2`/`dir2`
    // etc for a 2nd+ table on the page) so a sorted view round-trips through a bookmark/share the
    // same way a filtered one does.
    const sortKey = paramKey("sort", instanceIndex);
    const dirKey = paramKey("dir", instanceIndex);
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

    // Restore sort state from the URL, same spirit as the filter restore above -- validated
    // against the real column count so a stale/garbage param can't point past the end.
    {
      const rawCol = initialParams.get(sortKey);
      const col = rawCol !== null ? parseInt(rawCol, 10) : NaN;
      if (!isNaN(col) && col >= 0 && col < headerCells.length) {
        sortColIndex = col;
        sortDir = initialParams.get(dirKey) === "desc" ? -1 : 1;
      }
    }

    function updateHeaderIndicators() {
      for (const th of headerCells) {
        const active = Number(th.dataset.col) === sortColIndex;
        th.classList.toggle("datatable-sorted", active);
        th.dataset.sortDir = active ? (sortDir === 1 ? "asc" : "desc") : "";
      }
    }
    updateHeaderIndicators();
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
        (el) => matchesQuery(el, query) && dimensions.every((dim) => matchesDimension(el, dim))
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
      renderActiveChips();
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

    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".datatable").forEach((root, index) => initDataTable(root, index));

    // Close any open filter panel when clicking outside its own button+panel widget, or on
    // Escape -- shared across every datatable instance on the page.
    document.addEventListener("click", (e) => {
      for (const dim of allDimensions) {
        if (dim.panel && !dim.panel.hidden && dim.wrapper && !dim.wrapper.contains(e.target)) {
          dim.panel.hidden = true;
          dim.toggle?.setAttribute("aria-expanded", "false");
        }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      for (const dim of allDimensions) {
        if (dim.panel && !dim.panel.hidden) {
          dim.panel.hidden = true;
          dim.toggle?.setAttribute("aria-expanded", "false");
        }
      }
    });
  });
})();
