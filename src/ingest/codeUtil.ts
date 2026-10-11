/** Splits a possibly domain-prefixed code ("betterruins:schematic-x" / "rock-*") into {domain, bareCode}. */
export function splitDomainCode(raw: string, fallbackDomain: string): { domain: string; bareCode: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) return { domain: fallbackDomain, bareCode: raw };
  return { domain: raw.slice(0, idx), bareCode: raw.slice(idx + 1) };
}
