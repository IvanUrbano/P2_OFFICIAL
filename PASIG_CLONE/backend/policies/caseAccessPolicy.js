/**
 * Centralized Case Access Policy
 * 
 * Controls which TB cases a user can view/edit based on:
 * - User role (admin/staff)
 * - User's assigned facility
 * - Case's current responsible facility
 * - Transfer history
 */

/**
 * Returns SQL WHERE clause fragment and params for facility-scoped case listing.
 * @param {Object} user - req.user from JWT (id, username, email, role, facility_id)
 * @param {string} alias - Table alias (e.g., 'v' for validated_tb_cases)
 * @returns {{ where: string, params: number[] }}
 */
function getCaseListScope(user, alias = '') {
  const prefix = alias ? `${alias}.` : '';

  if (user.role === 'admin') {
    // ADMIN: city-wide access
    return { where: '1=1', params: [] };
  }

  // STAFF: facility-scoped
  if (!user.facility_id) {
    // No facility assigned = no case access
    return { where: '1=0', params: [] };
  }

  // Staff can see:
  // 1. Cases where their facility is the current responsible facility
  // 2. Cases where current_responsible_facility_id is NULL (historical/unresolved)
  return {
    where: `(${prefix}current_responsible_facility_id = $1 OR ${prefix}current_responsible_facility_id IS NULL)`,
    params: [user.facility_id],
  };
}

/**
 * Check if a user can view a specific case.
 * @param {Object} user
 * @param {Object} caseRecord
 * @returns {boolean}
 */
function canViewCase(user, caseRecord) {
  if (user.role === 'admin') return true;
  if (!user.facility_id) return false;

  // Current responsible facility
  if (caseRecord.current_responsible_facility_id === user.facility_id) return true;

  // NULL responsibility (historical/unresolved) — visible to all staff
  if (caseRecord.current_responsible_facility_id === null) return true;

  // Historical transferred case — check if user's facility was ever involved
  // For now, allow read access to historical cases (previous facility)
  // This is checked via the transfer history in the detail endpoint
  return false;
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
  getCaseListScope,
  canViewCase,
  canEditCase,
  canTransferCase,
  isReadOnlyForUser,
};