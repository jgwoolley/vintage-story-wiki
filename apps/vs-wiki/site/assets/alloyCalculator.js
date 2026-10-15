// Alloy ratio calculator (site/tools/alloy/index.njk). Alloy ranges and per-metal bit stack sizes
// are rendered into #alloyData by the template from the ingested recipe/item data.
const CRUCIBLE_SLOTS = 4;
const BITS_PER_INGOT = 20; // metalbit smeltedRatio in the game data
const $ = (id) => document.getElementById(id);
const alloys = JSON.parse($("alloyData").textContent);
const pct = (x) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;

let values = []; // slider value (0-100) per ingredient of the selected alloy

function selected() {
  return alloys[Number($("alAlloy").value)];
}

/** Integer bit counts for `total` bits at `ratios`, rounded so they sum to exactly `total`. */
function splitBits(ratios, total) {
  const raw = ratios.map((r) => r * total);
  const bits = raw.map(Math.floor);
  let left = total - bits.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (left-- > 0) bits[i]++;
  return bits;
}

/** Largest total bit count whose split fits CRUCIBLE_SLOTS stacks and keeps every metal inside its allowed range. */
function maxBits(alloy, ratios) {
  const cap = alloy.ingredients.reduce((m, i) => Math.max(m, i.stack), 0) * CRUCIBLE_SLOTS;
  for (let total = cap; total >= 1; total--) {
    const bits = splitBits(ratios, total);
    const slots = bits.reduce((s, n, i) => s + Math.ceil(n / alloy.ingredients[i].stack), 0);
    if (slots > CRUCIBLE_SLOTS) continue;
    const actual = bits.map((n) => n / total);
    const inRange = alloy.ingredients.every((ing, i) => actual[i] >= ing.min - 1e-9 && actual[i] <= ing.max + 1e-9);
    if (inRange) return { total, bits, slots };
  }
  return null;
}

function buildSliders() {
  const alloy = selected();
  const box = $("alSliders");
  box.replaceChildren();
  values = alloy.ingredients.map((i) => Math.round(((i.min + i.max) / 2) * 100));
  alloy.ingredients.forEach((ing, i) => {
    const row = document.createElement("div");
    row.className = "control-block";
    const head = document.createElement("div");
    head.className = "schematic-row";
    const label = document.createElement("span");
    label.textContent = `${ing.name} (allowed ${pct(ing.min)}–${pct(ing.max)})`;
    const out = document.createElement("span");
    out.className = "schematic-accent";
    out.id = `alOut${i}`;
    head.append(label, out);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(Math.round(ing.min * 100));
    slider.max = String(Math.round(ing.max * 100));
    slider.step = "1";
    slider.value = String(values[i]);
    slider.id = `alSlider${i}`;
    slider.addEventListener("input", () => {
      values[i] = Number(slider.value);
      update();
    });
    row.append(head, slider);
    box.append(row);
  });
  update();
}

function update() {
  const alloy = selected();
  const sum = values.reduce((a, b) => a + b, 0);
  const ratios = values.map((v) => v / sum);
  alloy.ingredients.forEach((_, i) => ($(`alOut${i}`).textContent = `${values[i]} (${pct(ratios[i])} of mix)`));
  $("alRatioNote").textContent = `Slider values are relative; they are normalized to 100% (sum ${sum}).`;

  const body = $("alBody");
  body.replaceChildren();
  const outOfRange = alloy.ingredients.filter((ing, i) => ratios[i] < ing.min - 1e-9 || ratios[i] > ing.max + 1e-9);
  const result = outOfRange.length ? null : maxBits(alloy, ratios);
  if (!result) {
    $("alSummary").textContent = outOfRange.length
      ? `This mix isn't a valid ${alloy.name.toLowerCase()}: ${outOfRange.map((i) => i.name).join(", ")} fall outside the allowed range after normalizing. Adjust the sliders.`
      : "No whole-bit split of this ratio fits the crucible while staying in range. Nudge a slider.";
    return;
  }
  $("alSummary").innerHTML = `Up to <strong>${result.total} bits</strong> (${(result.total / BITS_PER_INGOT).toFixed(1)} ingots of ${alloy.name.toLowerCase()}) using ${result.slots} of ${CRUCIBLE_SLOTS} slots.`;
  alloy.ingredients.forEach((ing, i) => {
    const tr = document.createElement("tr");
    for (const text of [ing.name, pct(result.bits[i] / result.total), `${pct(ing.min)}–${pct(ing.max)}`, String(result.bits[i]), `${Math.ceil(result.bits[i] / ing.stack)} (stack ${ing.stack})`]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  });
}

alloys.forEach((a, i) => $("alAlloy").append(new Option(a.name, String(i))));
$("alAlloy").addEventListener("change", buildSliders);
$("alMid").addEventListener("click", buildSliders);
buildSliders();
