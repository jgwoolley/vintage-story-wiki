// The "what is this chiseled block made of" section, shared by the schematic viewer's block panel and the
// schematic search page's shape panel: a count line and a table of materials (swatch, linked name, boxes, share of the 4096 voxels).
import { materialVolumes } from "./chisel.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * Returns an array of elements to append. `colorOf(code)` and `nameOf(code)` give a material's swatch and
 * display name; `itemsUrl` is the wiki's items listing (each material links to a search for its code).
 */
export function materialsSection(shape, { colorOf, nameOf, itemsUrl }) {
  const volumes = materialVolumes(shape);
  const total = volumes.reduce((a, b) => a + b, 0) || 1;
  const table = el("table", "chisel-materials");
  const headRow = document.createElement("tr");
  headRow.append(...["Material", "Boxes", "Volume"].map((h) => el("th", "", h)));
  table.append(headRow);
  shape.materials.forEach((code, i) => {
    const swatch = el("span", "color-box", "");
    swatch.style.background = colorOf(code);
    const link = Object.assign(document.createElement("a"), {
      href: `${itemsUrl}?q=${encodeURIComponent(code.replace(/^[^:]+:/, ""))}`,
      textContent: nameOf(code),
      title: code,
    });
    const nameCell = document.createElement("td");
    nameCell.append(swatch, " ", link);
    const row = document.createElement("tr");
    row.append(nameCell,
      el("td", "", String(shape.cuboids.filter((c) => c.material === i).length)),
      el("td", "", `${((volumes[i] / total) * 100).toFixed(0)}% (${volumes[i]}/4096)`));
    table.append(row);
  });
  const count = shape.materials.length;
  return [el("div", "trait", `Made from ${count} material${count === 1 ? "" : "s"}, ${shape.cuboids.length} boxes:`), table];
}
