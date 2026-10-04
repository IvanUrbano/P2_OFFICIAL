/**
 * Timestamp parsing for the PASIG clone.
 *
 * The Neon session runs with TimeZone = GMT, so every `timestamp without time
 * zone` column (created_at, validated_at, sent_at, synced_at, …) stores the UTC
 * wall clock. node-pg would otherwise parse that text in the process timezone,
 * shifting every value read back by the local offset (8 h in Manila) — e.g. a
 * 2:55 AM upload displayed as 6:55 PM the previous day.
 *
 * Read naive timestamps as UTC to match how they are stored. timestamptz
 * (offset-aware) and date columns keep their default parsers.
 */
const { types } = require('pg');

types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z'));

module.exports = {};
