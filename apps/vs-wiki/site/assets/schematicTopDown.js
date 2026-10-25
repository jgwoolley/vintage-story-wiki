// Draws a schematic from above on a canvas, like a map (site/schematics/schematics.njk, driven by schematicPreview.js): the top block of each
// column in its color, shaded by relief so heights read, with the block name and position under the pointer as a tooltip. The column
// logic is topDown.ts (libs/vs-schematic).
import { reliefShade } from "./topDown.js";

/** Pixels per block: as large as fits in `maxSize`, whole numbers so cells stay crisp. */
function cellSize(view, maxSize) {
  return Math.max(1, Math.min(24, Math.floor(maxSize / Math.max(view.width, view.depth))));
}

export function drawTopDown(canvas, view, colorOf, displayName, { maxSize = 720 } = {}) {
  const px = cellSize(view, maxSize);
  canvas.width = view.width * px;
  canvas.height = view.depth * px;
  const ctx = canvas.getContext("2d");
  const heightSpan = Math.max(1, view.maxY - view.minY);
  for (let cz = 0; cz < view.depth; cz++) {
    for (let cx = 0; cx < view.width; cx++) {
      const top = view.tops[cz * view.width + cx];
      if (!top) continue;
      ctx.fillStyle = colorOf(top.code);
      ctx.fillRect(cx * px, cz * px, px, px);
      // Relief from the neighbours, plus a gentle brightening with height; both are overlays so any CSS color works as the base.
      const shade = reliefShade(view, cx, cz) * 0.35 + ((top.y - view.minY) / heightSpan - 0.5) * 0.2;
      ctx.fillStyle = shade >= 0 ? `rgba(255,255,255,${Math.min(0.5, shade)})` : `rgba(0,0,0,${Math.min(0.6, -shade)})`;
      ctx.fillRect(cx * px, cz * px, px, px);
    }
  }
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - rect.left) / rect.width) * view.width);
    const cz = Math.floor(((e.clientY - rect.top) / rect.height) * view.depth);
    const top = view.tops[cz * view.width + cx];
    canvas.title = top ? `${displayName(top.code)} (x ${view.minX + cx}, y ${top.y}, z ${view.minZ + cz})` : "";
  });
}
