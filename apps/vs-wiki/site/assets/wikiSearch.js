// The header search box (base.njk): type to get matching pages from every section, one click away. The index (searchIndex.json.njk) is a list of
// [title, path, kind, code] rows fetched on first focus. Ranking: title starts with the query, then a word of the title starts with it, then the title or
// the code contains it; shorter titles first. Enter opens the highlighted result (or the first); with no match it falls back to the item list's own search.
// Press "/" anywhere to focus the box.
(function () {
  const form = document.getElementById("wikiSearchForm");
  if (!form) return;
  const input = document.getElementById("wikiSearch");
  const list = document.getElementById("wikiSearchResults");
  const base = form.dataset.base;
  let rows = null;
  let loading = null;
  let shown = [];
  let active = -1;

  function load() {
    loading ??= fetch(form.dataset.index)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        rows = data.map(([title, path, kind, code]) => ({ title, path, kind, code: code || "", lower: title.toLowerCase(), codeLower: (code || "").toLowerCase() }));
      })
      .catch(() => (rows = []));
    return loading;
  }

  function rank(row, q) {
    if (row.lower.startsWith(q)) return 0;
    if (row.lower.includes(` ${q}`) || row.lower.includes(`-${q}`)) return 1;
    if (row.lower.includes(q)) return 2;
    if (row.codeLower.includes(q)) return 3;
    return -1;
  }

  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return [];
    const hits = [];
    for (const row of rows) {
      const r = rank(row, q);
      if (r >= 0) hits.push({ row, r });
    }
    hits.sort((a, b) => a.r - b.r || a.row.title.length - b.row.title.length || a.row.title.localeCompare(b.row.title));
    return hits.slice(0, 12).map((h) => h.row);
  }

  function render() {
    list.replaceChildren(
      ...shown.map((row, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        if (i === active) li.className = "active";
        const a = document.createElement("a");
        a.href = base + row.path;
        a.append(row.title, Object.assign(document.createElement("span"), { className: "wiki-search-kind", textContent: row.kind }));
        li.append(a);
        return li;
      }),
    );
    list.hidden = shown.length === 0;
  }

  async function update() {
    await load();
    shown = search(input.value);
    active = shown.length ? 0 : -1;
    render();
  }

  input.addEventListener("focus", load);
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!shown.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      render();
    } else if (e.key === "Escape") {
      list.hidden = true;
      input.blur();
    }
  });
  form.addEventListener("submit", (e) => {
    const target = shown[Math.max(active, 0)];
    if (target) {
      e.preventDefault();
      location.href = base + target.path;
    } // else: the form's own action, the item list filtered by the query (?q=)
  });
  document.addEventListener("click", (e) => {
    if (!form.contains(e.target)) list.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
    if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
})();
