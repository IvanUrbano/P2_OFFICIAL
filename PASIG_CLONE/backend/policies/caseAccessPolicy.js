/**
 * Centralized Case Access Policy — hybrid, barangay-based.
 *
 *   ADMIN  — city-wide: every record, view + edit.
 *   STAFF  — assigned to ONE barangay (users.barangay_id). For each case:
 *
 *     responsible barangay = case.responsible_barangay_id, or the patient's barangay
 *                            (barangay_id) when no referral has moved it (NULL)
 *
 *     PRIMARY      patient lives in my barangay and it is still responsible  → view + edit
 *     REFERRED_IN  an ACCEPTED referral made my barangay responsible          → view + edit
 *     REFERRED_OUT patient lives in my barangay, responsibility moved away     → view only
 *     otherwise                                                                → no access
 *     Non-Pasig record (confirmed outside Pasig / non-Pasig city)              → no access
 *
 *   A pending referral grants nothing yet: the receiving barangay sees it only in its
 *   referral inbox, without patient identity, until it accepts.
 *
 * Deliberately NOT used for access: the staff member's legacy facility_id and the
 * free-text diagnosing/treatment facility on the record. Patient residence, staff
 * assignment, treating facility and referral are separate concepts; only residence
 * and accepted referrals decide access.
 *
 * Barangays are compared by id (users.barangay_id vs the case's barangay_id /
 * responsible_barangay_id, kept in step with the names by triggers — migration 006).
 * Records without ids (e.g. a barangay not yet mirrored) fail closed for staff.
 *
 * Analytics in TBInsight are aggregate and stay city-wide — this policy only governs
 * patient-level records in PASIG TB-IS.
 */

const db = require('../db/pasigSchema');

const ACCESS = Object.freeze({
  ADMIN: 'admin',
  PRIMARY: 'primary',
  REFERRED_IN: 'referred_in',
  REFERRED_OUT: 'referred_out',
});

const NO_ACCESS = Object.freeze({ canView: false, canEdit: false, basis: null });

/**
 * The staff user's access scope: { barangay_id, barangay_name } (their assigned
 * barangay), read from the database so a reassignment applies immediately. null for
 * admins and for staff with no assigned barangay (who therefore see no records).
 */
async function resolveUserScope(user) {
  if (!user || user.role === 'admin' || !user.id) return null;
  const res = await db.authPool.query(
    `SELECT b.id AS barangay_id, b.name AS barangay_name
     FROM users u JOIN barangays b ON b.id = u.barangay_id
     WHERE u.id = $1`,
    [user.id]
  );
  const row = res.rows[0];
  return row?.barangay_name ? { barangay_id: row.barangay_id ?? null, barangay_name: row.barangay_name } : null;
}

/** The barangay (name) currently responsible for a case. */
function responsibleBarangay(record) {
  return record?.responsible_barangay || record?.barangay_name || null;
}

/** Same barangay? Compared by id only — a side without an id never matches. */
function sameBarangay(aId, bId) {
  return aId != null && bId != null && Number(aId) === Number(bId);
}

/**
 * Non-Pasig record: an admin confirmed it as outside Pasig, or its city is not Pasig.
 * Such records are admin-only even when their barangay NAME matches a Pasig barangay
 * (the barangay_id trigger resolves the name regardless of city). A record without
 * these fields (e.g. a referral row) is treated as Pasig.
 */
function isNonPasig(record) {
  if (record?.location_resolution === 'outside_pasig') return true;
  if (record?.city == null) return false;
  const city = String(record.city).trim().toLowerCase();
  return city !== 'pasig' && city !== 'pasig city';
}

/**
 * Access to one case: { canView, canEdit, basis } where basis is one of ACCESS.*.
 * `record` needs barangay_id and responsible_barangay_id.
 */
function getCaseAccess(user, scope, record) {
  if (!user || !record) return NO_ACCESS;
  if (user.role === 'admin') return { canView: true, canEdit: true, basis: ACCESS.ADMIN };
  if (!scope || scope.barangay_id == null) return NO_ACCESS;
  if (isNonPasig(record)) return NO_ACCESS;

  const referred = record.responsible_barangay_id != null;
  const respId = referred ? record.responsible_barangay_id ?? null : record.barangay_id ?? null;
  const livesHere = sameBarangay(scope.barangay_id, record.barangay_id);
  const responsibleHere = sameBarangay(scope.barangay_id, respId);

  if (responsibleHere) {
    return { canView: true, canEdit: true, basis: livesHere ? ACCESS.PRIMARY : ACCESS.REFERRED_IN };
  }
  if (livesHere) {
    return { canView: true, canEdit: false, basis: ACCESS.REFERRED_OUT };
  }
  return NO_ACCESS;
}

function canViewCase(user, scope, record) {
  return getCaseAccess(user, scope, record).canView;
}

function canEditCase(user, scope, record) {
  return getCaseAccess(user, scope, record).canEdit;
}

/**
 * SQL WHERE fragment matching exactly the cases getCaseAccess() lets the user view.
 * @param {Object} user      req.user
 * @param {Object|null} scope from resolveUserScope(user)
 * @param {string} alias     table alias for validated_tb_cases
 * @param {number} startIdx  first $n placeholder number to use
 */
function getCaseListScope(user, scope, alias = '', startIdx = 1) {
  const p = alias ? `${alias}.` : '';
  if (user.role === 'admin') return { where: '1=1', params: [] };
  if (!scope || scope.barangay_id == null) return { where: '1=0', params: [] };
  const id = `$${startIdx}`;
  // Exactly the rule getCaseAccess() applies (barangays compared by id), so the list
  // never shows a case the user cannot open, or hides one they can:
  //   lives here       = patient barangay_id is mine
  //   responsible here = responsible_barangay_id is mine, or it is NULL (no accepted
  //                      referral) and the patient lives here
  //   visible          = lives here OR responsible here
  // Patient Rosario / responsible NULL or Rosario -> shown (view + edit)
  // Patient Rosario / responsible Maybunga        -> shown (view only)
  // Patient Maybunga / responsible Rosario        -> shown (view + edit)
  // Patient Maybunga or Ugong, not referred here  -> hidden
  // Cases with no barangay_id (unknown / outside Pasig) match no staff barangay; they
  // are handled under Validation -> Needs Assignment. Non-Pasig cases (confirmed outside
  // Pasig, or a non-Pasig city) are admin-only even when the barangay name matches —
  // same rule as isNonPasig().
  return {
    where: `((${p}barangay_id = ${id} OR COALESCE(${p}responsible_barangay_id, ${p}barangay_id) = ${id})
      AND ${p}location_resolution IS DISTINCT FROM 'outside_pasig'
      AND (${p}city IS NULL OR lower(trim(${p}city)) IN ('pasig city', 'pasig')))`,
    params: [scope.barangay_id],
  };
}

/** Can the user act as the RECEIVING side of a referral to `toBarangay`? */
function isReferralReceiver(user, scope, _toBarangay, toBarangayId = null) {
  if (user?.role === 'admin') return true;
  if (!scope) return false;
  return sameBarangay(scope.barangay_id, toBarangayId);
}

/** Can the user act as the SENDING side of a referral from `fromBarangay`? */
function isReferralSender(user, scope, _fromBarangay, fromBarangayId = null) {
  if (user?.role === 'admin') return true;
  if (!scope) return false;
  return sameBarangay(scope.barangay_id, fromBarangayId);
}

module.exports = {
  ACCESS,
  isNonPasig,
  resolveUserScope,
  responsibleBarangay,
  sameBarangay,
  getCaseAccess,
  canViewCase,
  canEditCase,
  getCaseListScope,
  isReferralReceiver,
  isReferralSender,
};
