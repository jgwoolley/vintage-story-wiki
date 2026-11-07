// The game's two ways of comparing versions, ported so vsdev decides "newer" and "good enough" the way Vintage Story does.
//
// - compareGameVersions: vsapi Config/GameVersion.cs (SplitVersionString + IsNewerVersionThan). The game uses it to order two copies of
//   one mod (which one loads, whether an installed copy is newer than a download). Split on "." and "-", a missing patch counts as 0,
//   and the 4th number is the release type: dev 0 < pre 1 < rc 2 < stable 3 (no suffix), so 1.0.0-rc.2 < 1.0.0.
// - satisfiesMinimum: ModLoader.SatisfiesVersion. A dependency's version is a minimum checked with SemVer (vsapi Datastructures/SemVer.cs,
//   whose TryParse keeps what it managed to read); "" and "*" accept anything.

/** GameVersion.SplitVersionString: numbers, with the release type as the 4th. Unparseable parts count as 0, as int.TryParse leaves them. */
export function splitGameVersion(version: string): number[] {
  let v = version.trim();
  const hyphen = v.indexOf("-");
  let head = hyphen < 1 ? v : v.slice(0, hyphen);
  if ((head.match(/\./g) ?? []).length === 1) {
    head += ".0"; // "1.17" -> "1.17.0", so a suffix still lands in the 4th place
    v = hyphen < 1 ? head : head + v.slice(hyphen);
  }
  const parts = v.split(/[.-]/);
  if (parts.length <= 3) parts.push("3");
  else parts[3] = parts[3] === "rc" ? "2" : parts[3] === "pre" ? "1" : "0";
  return parts.map((p) => (/^-?\d+$/.test(p) ? Number(p) : 0));
}

/** GameVersion.IsNewerVersionThan: compares over the reference's parts; a version with fewer parts is never newer. */
export function isNewerGameVersion(version: string, reference: string): boolean {
  const ref = splitGameVersion(reference);
  const cur = splitGameVersion(version);
  for (let i = 0; i < ref.length; i++) {
    if (i >= cur.length) return false;
    if (ref[i] > cur[i]) return false;
    if (ref[i] < cur[i]) return true;
  }
  return false;
}

/** 1 if a is newer, -1 if b is, 0 if neither (the game's ordering; equal strings are always 0). */
export function compareGameVersions(a: string, b: string): number {
  if (a === b) return 0;
  if (isNewerGameVersion(a, b)) return 1;
  if (isNewerGameVersion(b, a)) return -1;
  return 0;
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

/** A lenient SemVer read, like SemVer.TryParse's partial result: missing numbers are 0, "1.0.0pre2" is 1.0.0-pre2, build metadata ignored. */
export function parseSemVer(text: string): SemVer {
  const m = /^\s*v?(\d+)?(?:\.(\d+))?(?:\.(\d+))?-?([0-9A-Za-z.-]*)/.exec(text) ?? [];
  const pre = (m[4] ?? "").split(".").filter(Boolean);
  return { major: Number(m[1] ?? 0), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre };
}

/** SemVer precedence: numbers, then a pre-release sorts before none; numeric identifiers before text ones; more identifiers win a tie. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (xn && Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    if (!xn && x !== y) return x < y ? -1 : 1;
  }
  return Math.sign(a.pre.length - b.pre.length);
}

/** ModLoader.SatisfiesVersion: whether `provided` meets a dependency's minimum `requested` ("" or "*" = any; unknown provided passes). */
export function satisfiesMinimum(requested: string | undefined, provided: string | undefined): boolean {
  if (!requested || !provided || requested === "*") return true;
  return compareSemVer(parseSemVer(provided), parseSemVer(requested)) >= 0;
}
