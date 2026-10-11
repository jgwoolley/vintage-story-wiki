// Turns the build's UTC timestamp (embedded server-side, since a static site has no way to know
// "now" after the fact) into a relative "X ago" string, computed client-side at load time.
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
      if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"} ago`;
    }
    return "just now";
  }

  document.addEventListener("DOMContentLoaded", () => {
    for (const el of document.querySelectorAll("[data-build-time]")) {
      el.textContent = timeAgo(el.dataset.buildTime);
    }
  });
})();
