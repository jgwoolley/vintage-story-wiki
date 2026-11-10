// The preview sheet `vsdev texture` writes next to its renders: every texture enlarged (nearest neighbour, so pixels stay sharp) and
// tiled 2 x 2 (a seam shows as a line through the middle), on a checkerboard (transparency shows), labelled with its name.
import type { RgbaImage } from "../gen/png.js";
import { drawText } from "./font.js";

const CELL = 256, PAD = 12, LABEL = 2, LABEL_H = 5 * LABEL + 8, COLUMNS = 4;

export function previewSheet(items: { name: string; image: RgbaImage }[]): RgbaImage {
  const cols = Math.min(COLUMNS, items.length), rows = Math.ceil(items.length / cols);
  const width = cols * (CELL + PAD) + PAD, height = rows * (CELL + LABEL_H + PAD) + PAD;
  const data = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, c: ArrayLike<number>) => data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, [40, 40, 44]);
  items.forEach(({ name, image }, i) => {
    const ox = PAD + (i % cols) * (CELL + PAD), oy = PAD + Math.floor(i / cols) * (CELL + LABEL_H + PAD);
    const scale = Math.max(1, Math.floor(CELL / 2 / Math.max(image.width, image.height)));
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const sx = Math.floor(x / scale) % image.width, sy = Math.floor(y / scale) % image.height;
      if (x >= 2 * image.width * scale || y >= 2 * image.height * scale) continue;
      const o = (sy * image.width + sx) * 4, a = image.data[o + 3] / 255;
      const check = ((x >> 3) + (y >> 3)) % 2 ? 150 : 110;
      set(ox + x, oy + y, [0, 1, 2].map((k) => image.data[o + k] * a + check * (1 - a)));
    }
    const label = `${name} ${image.width}x${image.height}`.slice(0, Math.floor(CELL / (4 * LABEL)));
    drawText(label, (x, y) => {
      for (let dy = 0; dy < LABEL; dy++) for (let dx = 0; dx < LABEL; dx++) set(ox + x * LABEL + dx, oy + CELL + 4 + y * LABEL + dy, [230, 230, 220]);
    });
  });
  return { width, height, data };
}
