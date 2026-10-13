// After a deploy, a tab opened on the old version asks for page files (e.g.
// GisMap-<hash>.js) that the new deploy replaced, and the page fails to load.
// Reloading once fetches the new version. The timestamp stops a reload loop
// when the files are missing for another reason (server down, offline).

const KEY = 'tb-stale-chunk-reload';
const MIN_GAP_MS = 60_000;

export function isStaleChunkError(error) {
  const message = String(error?.message || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
}

/** Reloads unless it already did in the last minute; returns whether it reloaded. */
export function reloadOnceForStaleChunk({ storage, reload, now = Date.now() } = {}) {
  try {
    const last = Number(storage.getItem(KEY) || 0);
    if (last && now - last < MIN_GAP_MS) return false;
    storage.setItem(KEY, String(now));
  } catch {
    return false; // without storage there is no loop guard, so do not auto-reload
  }
  reload();
  return true;
}
