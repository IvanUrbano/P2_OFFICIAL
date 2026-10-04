/**
 * TBInsight — Barangay adjacency ("real neighbours")
 *
 * Two barangays are neighbours when their boundary polygons (barangays_geom,
 * PSGC 2023 hi-res, migration 014) touch. A 50 m tolerance absorbs the small
 * slivers between polygons digitised separately — e.g. Bagong Katipunan and
 * Santa Rosa are ~22 m apart in the source file but share a border on the
 * ground (PhilAtlas lists them as neighbours).
 *
 * Boundaries change only through a migration, so the map is cached for the
 * life of the process.
 */

const ADJACENCY_TOLERANCE_METERS = 50;

let cached = null;

/**
 * @returns {Promise<Object<string, string[]>|null>} {name: [neighbour names]},
 *   or null when the boundaries cannot be read (callers then fall back to
 *   treating every other barangay as a neighbour, the pre-adjacency behaviour).
 */
async function loadAdjacency(db) {
  if (cached) return cached;
  // Required lazily so scoring.js (which imports neighboursOf) stays usable
  // in pure unit tests without opening a database connection.
  db = db || require('../db');
  try {
    const { rows } = await db.query(
      `SELECT a.name, array_agg(b.name ORDER BY b.name) AS neighbours
       FROM barangays_geom a
       JOIN barangays_geom b
         ON a.name <> b.name
        AND ST_DWithin(a.geom::geography, b.geom::geography, $1)
       GROUP BY a.name`,
      [ADJACENCY_TOLERANCE_METERS]
    );
    if (rows.length === 0) return null;
    const map = {};
    for (const r of rows) map[r.name] = r.neighbours;
    cached = map;
    return map;
  } catch (err) {
    console.warn('⚠️ Barangay adjacency unavailable (using all other barangays):', err.message);
    return null;
  }
}

/** Neighbour list for `name`: bordering barangays, or every other barangay without a map. */
function neighboursOf(name, allNames, adjacency) {
  if (adjacency && adjacency[name]) return adjacency[name];
  return allNames.filter(n => n !== name);
}

function _clearAdjacencyCache() {
  cached = null;
}

module.exports = {
  ADJACENCY_TOLERANCE_METERS,
  loadAdjacency,
  neighboursOf,
  _clearAdjacencyCache,
};
