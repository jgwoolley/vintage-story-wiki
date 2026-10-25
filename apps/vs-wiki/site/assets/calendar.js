// Calendar tool (site/calendar/index.njk). Same arithmetic as the price guide's calendar
// page: 1 game day = 0.8 real hours at default settings; 12 months per year.
const REAL_HOURS_PER_GAME_DAY = 0.8;
const MONTHS_PER_YEAR = 12;
const $ = (id) => document.getElementById(id);

function num(id, fallback) {
  const v = parseInt($(id).value, 10);
  return Number.isFinite(v) ? v : fallback;
}

function update() {
  const dpm = Math.max(1, num("calDpm", 9));
  const year = Math.max(0, num("calYear", 0));
  const month = num("calMonth", 0);
  const day = Math.max(0, num("calDay", 0));
  const elapsedDays = year * MONTHS_PER_YEAR * dpm + month * dpm + day;
  $("calPerMonth").textContent = `${(dpm * REAL_HOURS_PER_GAME_DAY).toFixed(1)} real-life hours per month.`;
  $("calPerYear").textContent = `${(dpm * REAL_HOURS_PER_GAME_DAY * MONTHS_PER_YEAR).toFixed(1)} real-life hours per year.`;
  $("calElapsed").textContent = `${elapsedDays} game days elapsed (${(elapsedDays * REAL_HOURS_PER_GAME_DAY).toFixed(1)} real-life hours).`;
}

$("calForm").addEventListener("input", update);
update();
