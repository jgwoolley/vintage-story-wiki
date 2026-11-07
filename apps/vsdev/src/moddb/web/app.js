'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let mods = [], reports = {}, progress = {}, current = null;

async function api(path, opts) { const r = await fetch(path, opts); if (!r.ok) throw new Error(path + ': ' + r.status); return r.json(); }

async function init() {
  mods = await api('/api/mods');
  progress = await api('/api/progress');
  renderList();
  await Promise.all(mods.map(load));
  if (!current && mods.length) select(mods[0]);
}
async function load(id) {
  try { reports[id] = await api('/api/report/' + encodeURIComponent(id)); }
  catch (e) { reports[id] = { modId: id, state: 'error', error: e.message, tasks: [], warnings: [], releases: [], images: [], local: {}, }; }
  renderList();
  if (current === id) renderMain();
}
const open = (r) => r.tasks.filter(t => !progress[t.id]).length;
function renderList() {
  $('#list').innerHTML = mods.map(id => {
    const r = reports[id];
    return `<button class="item ${id === current ? 'sel' : ''}" data-id="${esc(id)}">${esc(id)}<small>${r
      ? `<span class="badge ${esc(r.state)}">${esc(r.state)}</span> ${open(r)} open · ${r.warnings.length} warn` : 'loading…'}</small></button>`;
  }).join('');
  document.querySelectorAll('.item').forEach(b => b.onclick = () => select(b.dataset.id));
}
function select(id) { current = id; renderList(); renderMain(); location.hash = id; }

async function copy(html, text) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text ?? html], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text ?? html);
    return true;
  } catch { try { await navigator.clipboard.writeText(text ?? html); return true; } catch { return false; } }
}
const stripTags = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };


// ---- line + word diff (LCS) ----
function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(['=', a[i], b[j]]); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push(['-', a[i++], null]); else ops.push(['+', null, b[j++]]);
  }
  while (i < n) ops.push(['-', a[i++], null]); while (j < m) ops.push(['+', null, b[j++]]);
  return ops;
}
function wordMark(x, y) { // highlight the words that differ between two lines
  const ta = x.split(/(\s+)/), tb = y.split(/(\s+)/);
  const ops = lcsDiff(ta, tb); let l = '', r = '';
  for (const [k, p, q] of ops) {
    if (k === '=') { l += esc(p); r += esc(q); }
    else if (k === '-') l += `<mark>${esc(p)}</mark>`; else r += `<mark>${esc(q)}</mark>`;
  }
  return [l, r];
}
// Side by side: left = Local (moddb/), right = the site. Changed runs are paired line by line.
function diffTable(local, live) {
  const a = (local ?? '').split('\n'), b = (live ?? '').split('\n');
  if (a.at(-1) === '') a.pop(); if (b.at(-1) === '') b.pop();
  const ops = lcsDiff(a, b), rows = []; let ln = 0, rn = 0;
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { ln++; rn++; rows.push(`<tr><td class="n">${ln}</td><td>${esc(ops[k][1])}</td><td class="n">${rn}</td><td>${esc(ops[k][2])}</td></tr>`); k++; continue; }
    const del = [], add = [];
    while (k < ops.length && ops[k][0] !== '=') { (ops[k][0] === '-' ? del : add).push(ops[k][0] === '-' ? ops[k][1] : ops[k][2]); k++; }
    for (let x = 0; x < Math.max(del.length, add.length); x++) {
      const d = del[x], u = add[x]; let l = d === undefined ? '' : esc(d), r = u === undefined ? '' : esc(u);
      if (d !== undefined && u !== undefined) [l, r] = wordMark(d, u);
      rows.push(`<tr><td class="n">${d === undefined ? '' : ++ln}</td><td class="${d === undefined ? 'blank' : 'del'}">${l}</td><td class="n">${u === undefined ? '' : ++rn}</td><td class="${u === undefined ? 'blank' : 'add'}">${r}</td></tr>`);
    }
  }
  return `<table class="dt"><tr><th></th><th>Local (moddb/)</th><th></th><th>On the site</th></tr>${rows.join('')}</table>`;
}
function fileStatus(f) {
  if (f.live == null) return ['only local', 'new'];
  if (f.local == null) return ['only on the site', 'bad'];
  return f.local === f.live ? ['same', 'ok'] : ['differs', 'warn'];
}

function frame(html) { return `<iframe sandbox srcdoc="${esc(html || '<p style=color:gray>(empty)</p>')}"></iframe>`; }
function copyBtn(label, key) { return `<button data-copy="${esc(key)}">${esc(label)}</button>`; }

// Which view (local / site / diff) each section shows; kept across re-renders.
const views = {};
const MODES = [['local', 'Local'], ['site', 'Site'], ['diff', 'Diff']];
function viewOf(key, differs) { return views[current + '|' + key] || (differs ? 'diff' : 'local'); }
function switcher(key, mode, hasSite) {
  return `<span class="seg">${MODES.map(([m, l]) => `<button data-view="${esc(key)}|${m}" class="${m === mode ? 'on' : ''}" ${m !== 'local' && !hasSite ? 'disabled title="not on the site"' : ''}>${l}</button>`).join('')}</span>`;
}
const same = (f) => f && f.local != null && f.live != null && f.local === f.live;
// html text shown as rendered local / rendered site / source diff
function htmlView(key, local, live, files) {
  const hasSite = live != null;
  const differs = hasSite && !(files.every(same));
  const mode = viewOf(key, differs);
  let body;
  if (mode === 'local') body = frame(local);
  else if (mode === 'site') body = frame(live);
  else body = hasSite ? files.map(f => fileStatus(f)[1] === 'ok' ? `<p class="hint"><code>${esc(f.name)}</code> is identical.</p>` : `<div class="hint"><code>${esc(f.name)}</code></div>${diffTable(f.local, f.live)}`).join('') : '<p class="hint">Not on the site yet: nothing to compare.</p>';
  return switcher(key, mode, hasSite) + `<div class="viewbody">${body}</div>`;
}
function chip(cls, label) { return `<span class="st ${cls}">${esc(label)}</span>`; }
function sectionStatus(files, hasSite) {
  if (!hasSite) return ['new', 'not on the site'];
  return files.every(same) ? ['ok', 'same'] : ['warn', 'differs'];
}

function renderMain() {
  const r = reports[current];
  const main = $('#main'); const scroll = main.scrollTop;
  if (!r) { main.innerHTML = '<p>Loading…</p>'; return; }
  const copies = {}; const h = [];
  const file = (n) => (r.files || []).find(f => f.name === n);
  const hasSite = !!r.live;

  // ---- header + checklist ----
  h.push(`<h2>${esc(r.local.name || r.modId)} <span class="badge ${esc(r.state)}">${esc(r.state)}</span></h2>`);
  h.push(`<div class="hint">${esc(r.modId)} · local ${esc(r.localVersion || '-')}${r.zip ? ' · ' + esc(r.zip) : ''}${r.pageUrl ? ` · <a href="${esc(r.pageUrl)}" target="_blank" rel="noopener">open on site</a>` : ''}</div>`);
  if (r.error) h.push(`<p class="bad">${esc(r.error)}</p>`);
  h.push(`<div class="bar"><button id="refresh">Refresh from site</button><button id="next">Next mod →</button></div>`);

  h.push('<h3>Checklist</h3>');
  for (const t of r.tasks) {
    const on = !!progress[t.id]; const cmd = t.detail && t.detail.startsWith('vsdev ');
    if (cmd) copies['task:' + t.id] = [null, t.detail];
    h.push(`<label class="task ${on ? 'checked' : ''}"><input type="checkbox" data-task="${esc(t.id)}" ${on ? 'checked' : ''}><span><span class="t">${esc(t.title)}</span>
      ${t.url ? ` <a href="${esc(t.url)}" target="_blank" rel="noopener">open</a>` : ''}
      <div class="d">${cmd ? `<code>${esc(t.detail)}</code> ${copyBtn('Copy', 'task:' + t.id)}` : esc(t.detail)}</div></span></label>`);
  }
  if (r.warnings.length) { h.push('<h3>Warnings</h3>'); r.warnings.forEach(w => h.push(`<div class="warn">⚠ ${esc(w)}</div>`)); }

  // ---- differences: only links to the sections ----
  const descF = file('description.html'), pageF = file('page.json');
  const links = [['sec-desc', 'Description', sectionStatus(descF ? [descF] : [], hasSite && descF?.live != null)],
                 ['sec-fields', 'Fields and tags (page.json)', sectionStatus(pageF ? [pageF] : [], hasSite)]];
  for (const rel of r.releases) {
    const fs = ['releases/' + rel.version + '.html', 'releases/' + rel.version + '.json'].map(file).filter(Boolean);
    links.push(['sec-rel-' + rel.version, 'Release ' + rel.version, sectionStatus(fs, rel.uploaded || rel.liveChangelog != null)]);
  }
  links.push(['sec-images', 'Images', r.images.length && r.images.every(i => i.localUrl && i.liveUrl) ? ['ok', 'present'] : r.images.some(i => !i.localUrl || !i.liveUrl) ? ['warn', 'missing some'] : ['new', 'none']]);
  h.push('<h3>Differences</h3><div class="links">' + links.map(([id, label, [cls, st]]) => `<a href="#" data-goto="${id}">${esc(label)}</a> ${chip(cls, st)}`).join(' · ') + '</div>');
  if (!hasSite) h.push('<p class="hint">Nothing to compare yet: the page is not on the site, or the site was not reached.</p>');

  // ---- description ----
  const [dc, dl] = sectionStatus(descF ? [descF] : [], hasSite);
  copies.desc = [r.localDescription, stripTags(r.localDescription)]; copies.descsrc = [null, r.localDescription];
  h.push(`<h3 id="sec-desc">Description ${chip(dc, dl)}</h3>
    <div class="bar">${copyBtn('Copy description (rich text)', 'desc')}${copyBtn('Copy HTML source', 'descsrc')}</div>
    ${htmlView('desc', r.localDescription, r.liveDescription, descF ? [descF] : [])}`);

  // ---- fields / tags ----
  const rows = [['Name', 'name'], ['Side', 'side'], ['Type', 'type'], ['Homepage', 'homepage'], ['Source code', 'sourceCode'], ['Trailer', 'trailer'], ['Issue tracker', 'issueTracker'], ['Wiki', 'wiki']];
  const lt = (r.local.tags || []).join(', '), vt = r.live ? r.live.tags.join(', ') : null;
  const [fc, fl] = sectionStatus(pageF ? [pageF] : [], hasSite);
  const fmode = viewOf('fields', hasSite && !same(pageF));
  let fbody;
  if (fmode === 'diff') fbody = hasSite ? diffTable(pageF?.local, pageF?.live) : '<p class="hint">Not on the site yet.</p>';
  else {
    const side = fmode; // local | site
    const t = ['<table><tr><th>Field</th><th>' + (side === 'local' ? 'Local' : 'On the site') + '</th><th></th></tr>'];
    for (const [label, k] of rows) {
      const l = r.local[k] ?? '', v = r.live ? (r.live[k] ?? '') : null; const val = side === 'local' ? l : v;
      if (side === 'local') copies['f:' + k] = [null, l];
      t.push(`<tr><td>${label}</td><td class="${side === 'local' && v !== null && v !== l ? 'diff' : ''}">${esc(val)}</td><td>${side === 'local' && l ? copyBtn('Copy', 'f:' + k) : ''}</td></tr>`);
    }
    copies.tags = [null, lt];
    const tv = side === 'local' ? lt : vt;
    t.push(`<tr><td>Tags</td><td class="${side === 'local' && vt !== null && vt.toLowerCase() !== lt.toLowerCase() ? 'diff' : ''}">${esc(tv)}</td><td>${side === 'local' && lt ? copyBtn('Copy', 'tags') : ''}</td></tr></table>`);
    fbody = t.join('');
  }
  h.push(`<h3 id="sec-fields">Fields and tags ${chip(fc, fl)}</h3>${switcher('fields', fmode, hasSite)}<div class="viewbody">${fbody}</div>`);

  // ---- releases ----
  h.push('<h3>Releases</h3>');
  for (const rel of r.releases) {
    const fs = ['releases/' + rel.version + '.html', 'releases/' + rel.version + '.json'].map(file).filter(Boolean);
    const onSite = rel.uploaded || rel.liveChangelog != null;
    const [rc, rl] = sectionStatus(fs, onSite);
    copies['cl:' + rel.version] = [rel.localChangelog, stripTags(rel.localChangelog)];
    if (rel.zip) copies['zip:' + rel.version] = [null, rel.zip];
    copies['gv:' + rel.version] = [null, rel.gameVersions.join(', ')];
    h.push(`<div class="release" id="sec-rel-${esc(rel.version)}"><b>${esc(rel.version)}</b> ${rel.uploaded ? '<span class="badge uploaded">uploaded</span>' : rel.inZip ? '<span class="badge new-version">not uploaded</span>' : ''} ${chip(rc, rl)}
      <span class="hint">game: ${esc(rel.gameVersions.join(', ') || '-')}</span>
      <div class="bar">${rel.zip ? copyBtn('Copy zip name', 'zip:' + rel.version) : ''}${rel.localChangelog ? copyBtn('Copy changelog (rich text)', 'cl:' + rel.version) : '<span class="warn">no changelog</span>'}
      ${rel.gameVersions.length ? copyBtn('Copy game versions', 'gv:' + rel.version) : ''}</div>
      ${htmlView('rel-' + rel.version, rel.localChangelog, onSite ? (rel.liveChangelog ?? '') : null, fs)}</div>`);
  }

  // ---- images ----
  h.push('<h3 id="sec-images">Images</h3>');
  if (!r.images.length) h.push('<p class="hint">none listed in page.json</p>');
  h.push('<div class="imgs">' + r.images.map(i => `<figure><b>${esc(i.kind)}: ${esc(i.name)}</b>
    <div class="hint">local</div>${i.localUrl ? `<img src="${esc(i.localUrl)}">` : '<span class="warn">missing</span>'}
    <div class="hint">site</div>${i.liveUrl ? `<img src="${esc(i.liveUrl)}">` : '<span class="hint">not on site</span>'}</figure>`).join('') + '</div>');

  main.innerHTML = h.join(''); main.scrollTop = scroll;
  $('#refresh').onclick = async () => { await api('/api/refresh', { method: 'POST' }); load(current); };
  $('#next').onclick = () => select(mods[(mods.indexOf(current) + 1) % mods.length]);
  main.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    const [html, text] = copies[b.dataset.copy] || [];
    const ok = await copy(html, text ?? html); const old = b.textContent;
    b.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => b.textContent = old, 1500);
  });
  main.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const [k, m] = b.dataset.view.split('|'); views[current + '|' + k] = m; renderMain(); });
  main.querySelectorAll('[data-goto]').forEach(a => a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  main.querySelectorAll('[data-task]').forEach(c => c.onchange = async () => {
    progress[c.dataset.task] = c.checked; if (!c.checked) delete progress[c.dataset.task];
    await api('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.dataset.task, done: c.checked }) });
    renderList(); renderMain();
  });
}

$('#refreshAll').onclick = async () => { await api('/api/refresh', { method: 'POST' }); reports = {}; renderList(); await Promise.all(mods.map(load)); };
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea') || e.metaKey || e.ctrlKey) return;
  const i = mods.indexOf(current);
  if (e.key === 'j') select(mods[Math.min(mods.length - 1, i + 1)]);
  if (e.key === 'k') select(mods[Math.max(0, i - 1)]);
});
init().then(() => { const h = decodeURIComponent(location.hash.slice(1)); if (mods.includes(h)) select(h); });
