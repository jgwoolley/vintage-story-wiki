// Outcome types shared by the download commands and the wiki's `npm run download` wrapper (which records them in downloadTiming.json).

export type DownloadAction =
  | "downloaded" // actually fetched from the network this run
  | "skipped-present" // already present on disk, left untouched (the common case once cached)
  | "failed"; // lookup/fetch failed; see the console log for the specific error

export interface ModDownloadResult {
  modid: string;
  action: DownloadAction;
  durationMs: number; // wall-clock time spent on just this mod (lookup + fetch, or the skip-check)
}
