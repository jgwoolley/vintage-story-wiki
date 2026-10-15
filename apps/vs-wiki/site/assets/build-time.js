// Turns the build's UTC timestamp (embedded server-side, since a static site has no way to know
// "now" after the fact) into a relative time string, computed client-side at load time. The
// " ago" suffix lives in a sibling [data-build-ago] element (see base.njk's footer) rather than
// in this string, since "just now" reads wrong with " ago" appended ("just now ago").
(function () {
  function timeAgo(isoString) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
    const units = [
      ["year", 31536000],
      ["month", 2592000],
      ["day", 86400],
      ["hour", 3600],
      ["min", 60],
      ["sec", 1],
    ];
    if (seconds < 1) return "just now";
    for (const [label, secondsPerUnit] of units) {
      const value = Math.floor(seconds / secondsPerUnit);
      if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"}`;
    }
    return "just now";
  }

  document.addEventListener("DOMContentLoaded", () => {
    for (const el of document.querySelectorAll("[data-build-time]")) {
      const text = timeAgo(el.dataset.buildTime);
      el.textContent = text;
      if (text === "just now") {
        const ago = el.closest("p")?.querySelector("[data-build-ago]");
        if (ago) ago.textContent = "";
      }
    }
  });
})();
