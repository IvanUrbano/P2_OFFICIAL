/**
 * Possible-duplicate flagging (never rejection). For every given DSTB fingerprint or MN
 * itis_case_id, if more than one tb_cases row shares it, flag every row except the
 * earliest (lowest id) as a possible duplicate of that earliest row. Only rows currently
 * 'unique' are touched; nothing is deleted, merged, or blocked.
 *
 * Returns { dstb, mn } — how many rows were newly flagged.
 */
async function flagPossibleDuplicates(client, { dstbFingerprints = [], mnItisCaseIds = [] }) {
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

  let mn = 0;
  if (mnItisCaseIds.length > 0) {
    const result = await client.query(
      `UPDATE tb_cases t
       SET duplicate_status = 'possible_duplicate', duplicate_of_case_id = earliest.id,
           duplicate_flag_reason = 'MN_ITIS_ID_COLLISION'
       FROM (
         SELECT itis_case_id, MIN(id) AS id
         FROM tb_cases
         WHERE source_type = 'MN' AND itis_case_id = ANY($1::text[])
         GROUP BY itis_case_id
         HAVING COUNT(*) > 1
       ) earliest
       WHERE t.itis_case_id = earliest.itis_case_id
         AND t.id != earliest.id
         AND t.source_type = 'MN'
         AND t.duplicate_status = 'unique'
       RETURNING t.id`,
      [mnItisCaseIds]
    );
    mn = result.rows.length;
  }

  return { dstb, mn };
}

module.exports = { flagPossibleDuplicates };
