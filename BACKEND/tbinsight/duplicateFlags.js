/**
 * Possible-duplicate flagging (never rejection). For every given DSTB fingerprint,
 * if more than one tb_cases row shares it, flag every row except the
 * earliest (lowest id) as a possible duplicate of that earliest row. Only rows currently
 * 'unique' are touched; nothing is deleted, merged, or blocked.
 *
 * Returns { dstb } — how many rows were newly flagged.
 *
 * Only rows still marked 'unique' are touched, which also gives MISSING_CASE_ID
 * (migration 032) precedence: a record with no Case ID is already flagged, so
 * its reason is never overwritten by a collision found later — and a row that
 * cannot be matched on a resend is exactly the row that needs review first.
 */
async function flagPossibleDuplicates(client, { dstbFingerprints = [] }) {
  let dstb = 0;
  if (dstbFingerprints.length > 0) {
    const result = await client.query(
      `UPDATE tb_cases t
       SET duplicate_status = 'possible_duplicate', duplicate_of_case_id = earliest.id,
           duplicate_flag_reason = 'DSTB_FINGERPRINT_COLLISION'
       FROM (
         SELECT dstb_fingerprint, MIN(id) AS id
         FROM tb_cases
         WHERE source_type = 'DSTB' AND dstb_fingerprint = ANY($1::text[])
         GROUP BY dstb_fingerprint
         HAVING COUNT(*) > 1
       ) earliest
       WHERE t.dstb_fingerprint = earliest.dstb_fingerprint
         AND t.id != earliest.id
         AND t.source_type = 'DSTB'
         AND t.duplicate_status = 'unique'
       RETURNING t.id`,
      [dstbFingerprints]
    );
    dstb = result.rows.length;
  }

  return { dstb };
}

module.exports = { flagPossibleDuplicates };
