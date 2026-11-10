// Small checks ported from ModDbCli (translocator-locator-cmd): VersionRules.cs (a new version should follow the newest listed one),
// HtmlLint.cs (tags the site's description editor is known to keep) and ImageChecks.cs (sizes ModDB accepts, read from the PNG/JPEG
// headers, no image library).

/** VersionRules.Parse: MAJOR.MINOR.PATCH at the start (a pre-release/build suffix is ignored), else null. */
export function parseTriple(text: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export const compareTriple = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** VersionRules.Warnings: from X.Y.Z the natural next versions are X.Y.(Z+1), X.(Y+1).0 and (X+1).0.0. */
export function versionWarnings(version: string, listed: string[]): string[] {
  const next = parseTriple(version);
  if (!next) return [`version '${version}' is not MAJOR.MINOR.PATCH, so the numbering was not checked`];
  const known = listed.map((text) => ({ parsed: parseTriple(text), text })).filter((k): k is { parsed: [number, number, number]; text: string } => !!k.parsed);
  if (!known.length) return [];
  const latest = known.reduce((a, b) => (compareTriple(b.parsed, a.parsed) > 0 ? b : a), known[0]);
  if (compareTriple(next, latest.parsed) <= 0) return [`${version} is not newer than the newest listed version ${latest.text}`];
  const [x, y, z] = latest.parsed;
  const allowed = [[x, y, z + 1], [x, y + 1, 0], [x + 1, 0, 0]];
  if (allowed.some((a) => compareTriple(a, next) === 0)) return [];
  return [`${version} skips version numbers after ${latest.text} (expected one of: ${allowed.map((a) => a.join(".")).join(", ")})`];
}

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "code", "pre", "br", "a"]);

/** HtmlLint.Problems: tags outside the subset the site's editor keeps. */
export function htmlLint(name: string, html: string): string[] {
  const bad = [...new Set([...html.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase()).filter((t) => !ALLOWED_TAGS.has(t)))].sort((a, b) => Number(a > b) - Number(a < b));
  const out = bad.length ? [`${name}: uses tags outside the usual subset: ${bad.map((t) => `<${t}>`).join(", ")}`] : [];
  // The editor's own code blocks are <pre class="language-x"><code>...</code></pre>; a bare <pre> loses its formatting when pasted.
  const bare = [...html.matchAll(/<pre\b([^>]*)>\s*(<code\b)?/gi)].filter((m) => !/class\s*=\s*["'][^"']*\blanguage-/i.test(m[1]) || !m[2]);
  if (bare.length) out.push(`${name}: ${bare.length} <pre> without a language-* class and a <code> inside; write code blocks as <pre class="language-json"><code>...</code></pre> (the editor's own markup), or they lose their formatting when pasted`);
  return out;
}

export const IMAGE_LIMITS = { maxBytes: 2 * 1024 * 1024, maxWidth: 1920, maxHeight: 1080, logoSize: 480, iconSize: 128 };

/** ImageChecks.Dimensions: width and height of a PNG or JPEG, or null if the bytes are neither (or truncated). */
export function imageDimensions(d: Uint8Array): [number, number] | null {
  const int = (at: number) => ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0;
  if (d.length >= 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return [int(16), int(20)];
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = d[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (d[i + 2] << 8) | d[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [(d[i + 7] << 8) | d[i + 8], (d[i + 5] << 8) | d[i + 6]];
    i += 2 + length;
  }
  return null;
}

/** ImageChecks.Check: problems of one file; `kind` is "icon", "logo" or "screenshot". */
export function imageChecks(kind: "icon" | "logo" | "screenshot", name: string, data: Uint8Array): string[] {
  const dims = imageDimensions(data);
  if (!dims) return [`${name}: not a readable PNG/JPEG`];
  const [w, h] = dims;
  const L = IMAGE_LIMITS;
  if (kind === "icon" && (w !== L.iconSize || h !== L.iconSize)) return [`${name}: mod icon is ${w}x${h}, expected ${L.iconSize}x${L.iconSize}`];
  if (kind === "logo" && (w !== L.logoSize || h !== L.logoSize)) return [`${name}: logo is ${w}x${h}, expected ${L.logoSize}x${L.logoSize}`];
  const out: string[] = [];
  if (kind === "screenshot") {
    if (w > L.maxWidth || h > L.maxHeight) out.push(`${name}: ${w}x${h} is larger than ${L.maxWidth}x${L.maxHeight}`);
    if (data.length > L.maxBytes) out.push(`${name}: ${Math.floor(data.length / 1024)} KB is larger than 2 MB`);
  }
  return out;
}
