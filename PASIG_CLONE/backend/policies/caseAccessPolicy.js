/**
 * Centralized Case Access Policy
 * 
 * Viewing: role + the patient's barangay / treatment facility (see below).
 * Editing / transfers: role + the case's current responsible facility.
 */

const db = require('../db/pasigSchema');

// VISIBILITY (who can see a record, names included):
//   ADMIN — every record.
//   STAFF — a record is visible when ANY of these is true:
//     1. the patient lives in the barangay of the staff's assigned facility,
//     2. the patient is treated at the staff's assigned facility, or
//     3. the case was transferred to the staff's facility (it is the case's current
//        responsible facility after a completed transfer).
//   Staff with no assigned facility see no records.
// The treatment facility on a record is free text from the source file, so it is
// compared by name with case/punctuation ignored; an unmatched name simply falls
// back to rule 1. Edit/transfer permissions below are separate and unchanged.

function normFacility(name) {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return n || null;
}

/** The staff user's assigned facility ({ id, name, barangay_name }), or null. */
async function resolveUserFacility(user) {
  if (!user || user.role === 'admin' || !user.facility_id) return null;
  const res = await db.authPool.query(
    'SELECT id, name, barangay_name FROM health_facilities WHERE id = $1',
    [user.facility_id]
  );
  return res.rows[0] || null;
}

/**
 * SQL WHERE fragment for record listing.
 * @param {Object} user      req.user
 * @param {Object|null} facility  from resolveUserFacility(user)
 * @param {string} alias     table alias for validated_tb_cases
 * @param {number} startIdx  first $n placeholder number to use
 */
function getCaseListScope(user, facility, alias = '', startIdx = 1) {
  const p = alias ? `${alias}.` : '';
  if (user.role === 'admin') return { where: '1=1', params: [] };
  if (!facility) return { where: '1=0', params: [] };
  return {
    where: `(lower(${p}barangay_name) = lower($${startIdx})
             OR regexp_replace(lower(coalesce(${p}treatment_facility, '')), '[^a-z0-9]', '', 'g') = $${startIdx + 1}
             OR ${p}current_responsible_facility_id = $${startIdx + 2})`,
    params: [facility.barangay_name || null, normFacility(facility.name), facility.id],
  };
}

function canViewCase(user, facility, caseRecord) {
  if (user.role === 'admin') return true;
  if (!facility) return false;
  const livesHere = facility.barangay_name && caseRecord.barangay_name &&
    String(caseRecord.barangay_name).toLowerCase() === String(facility.barangay_name).toLowerCase();
  const fac = normFacility(facility.name);
  const treatedHere = fac !== null && normFacility(caseRecord.treatment_facility) === fac;
  const transferredHere = caseRecord.current_responsible_facility_id != null
    && Number(caseRecord.current_responsible_facility_id) === Number(facility.id);
  return Boolean(livesHere || treatedHere || transferredHere);
}

/**
 * Check if a user can edit a specific case.
 * @param {Object} user
 * @param {Object} caseRecord
 * @returns {boolean}
 */
function canEditCase(user, caseRecord) {
  if (user.role === 'admin') return true;
  if (!user.facility_id) return false;

  // Only current responsible facility can edit
  return caseRecord.current_responsible_facility_id === user.facility_id;
}

/**
 * Check if a user can initiate a transfer for a case.
 * @param {Object} user
 * @param {Object} caseRecord
 * @returns {boolean}
 */
function canTransferCase(user, caseRecord) {
  if (user.role === 'admin') return true;
  if (!user.facility_id) return false;

  // Only current responsible facility can initiate transfer
  return caseRecord.current_responsible_facility_id === user.facility_id;
}

/**
 * Determine if a case is read-only for the given user.
 * Returns true for staff viewing historical/transferred cases.
 * @param {Object} user
 * @param {Object} caseRecord
 * @returns {boolean}
 */
function isReadOnlyForUser(user, caseRecord) {
  if (user.role === 'admin') return false;
  if (!user.facility_id) return true;

  // Current responsible facility can edit
  if (caseRecord.current_responsible_facility_id === user.facility_id) return false;

  // Everyone else sees read-only
  return true;
}

module.exports = {
  resolveUserFacility,
  getCaseListScope,
  canViewCase,
  canEditCase,
  canTransferCase,
  isReadOnlyForUser,
};