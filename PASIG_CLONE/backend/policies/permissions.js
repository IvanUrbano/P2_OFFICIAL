/**
 * Centralized view / edit permissions — the ONE place that decides what a user may do.
 *
 * Built on caseAccessPolicy (who can see / edit a case: admin city-wide; staff by their
 * assigned barangay — primary, referred in, or referred out = view only). Routes ask
 * `can(user, scope, action, resource)` before acting, and attach the matching
 * `…Permissions()` object to every resource they return, so the frontend only mirrors
 * these decisions (utils/permissions.js) and never re-derives them.
 *
 * Nothing here looks at facilities for CASE access: access follows the barangay
 * assignment only. facilityPermissions() below is about the facility DIRECTORY (master
 * data) — who may add/edit/deactivate facilities and manage aliases — and never grants
 * or denies a single patient record.
 */

const {
  getCaseAccess, isReferralReceiver, isReferralSender, sameBarangay,
} = require('./caseAccessPolicy');

const ACTIONS = Object.freeze({
  // patient cases
  CASE_VIEW: 'case:view',
  CASE_EDIT: 'case:edit',
  CASE_REFER: 'case:refer',
  CASE_ARCHIVE: 'case:archive',
  MATCH_RESOLVE: 'match:resolve',
  // referrals
  REFERRAL_VIEW: 'referral:view',
  REFERRAL_ACCEPT: 'referral:accept',
  REFERRAL_REJECT: 'referral:reject',
  REFERRAL_CANCEL: 'referral:cancel',
  // validation queue
  ISSUE_FIX: 'issue:fix',
  ISSUE_EXCLUDE: 'issue:exclude',
  LOCATION_ASSIGN: 'assignment:location',
  FACILITY_MAP: 'assignment:facility',
});

const isAdmin = (user) => user?.role === 'admin';

/**
 * What the user may do with one case.
 * @returns {{ view, edit, refer, archive, resolveMatch, basis }}
 *   basis: 'admin' | 'primary' | 'referred_in' | 'referred_out' | null (why they can see it)
 */
function casePermissions(user, scope, record) {
  const a = getCaseAccess(user, scope, record);
  const live = record && !record.is_archived && !record.merged_into_case_no;
  const pendingMatch = record?.match_status === 'pending';
  return {
    view: a.canView,
    edit: a.canEdit && live,
    refer: a.canEdit && live && !pendingMatch,
    archive: a.canEdit && live,
    resolveMatch: a.canEdit && pendingMatch,
    basis: a.basis,
  };
}

/**
 * What the user may do with one referral (case_transfers row joined with its case's
 * barangay_name / barangay_id / responsible_barangay(_id)).
 * @returns {{ view, viewCase, accept, reject, cancel, direction }}
 *   direction: 'incoming' | 'outgoing' | null (admin)
 */
function referralPermissions(user, scope, t) {
  const admin = isAdmin(user);
  const receiver = isReferralReceiver(user, scope, t.to_barangay, t.to_barangay_id);
  const sender = isReferralSender(user, scope, t.from_barangay, t.from_barangay_id)
    || Number(t.initiated_by_user_id) === Number(user?.id);
  const pending = t.status === 'pending';
  return {
    view: admin || receiver || sender,
    // The case itself opens only once the user may see it — a pending incoming referral
    // does not grant access yet.
    viewCase: getCaseAccess(user, scope, t).canView,
    accept: pending && t.to_barangay_id != null && receiver,
    reject: pending && receiver && (admin || !sender),
    cancel: pending && sender,
    direction: admin ? null : receiver ? 'incoming' : sender ? 'outgoing' : null,
  };
}

/**
 * What the user may do with one open data issue (validation_issues row).
 * Compared by barangay id like every other access check — an issue without a
 * recognised barangay id matches no staff (admins are unaffected).
 *
 * `reason` explains a denial so the UI can say WHY instead of a bare "View only":
 *   'admin_required' — the row's barangay never matched (barangay_id NULL): admin only.
 *   'other_barangay' — assigned to a different barangay's staff (name shown by the UI).
 * The uploader of the batch is deliberately not part of this decision.
 */
function issuePermissions(user, scope, issue) {
  const open = issue?.status === undefined || issue?.status === 'open';
  if (isAdmin(user)) return { fix: open, exclude: open, reason: null };
  if (sameBarangay(scope?.barangay_id, issue?.barangay_id)) return { fix: open, exclude: open, reason: null };
  const reason = issue?.barangay_id == null ? 'admin_required' : 'other_barangay';
  return { fix: false, exclude: false, reason };
}

/** Validation-queue decisions that are not about a single record. */
function validationPermissions(user) {
  return { assignLocation: isAdmin(user), mapFacility: isAdmin(user) };
}

/**
 * Facility directory (master data) decisions — who may change the registry itself.
 *   view / search / details — every authenticated role (staff browse the directory).
 *   add / edit / activate / aliases / resolveMapping — admin only:
 *     add       POST /api/facilities
 *     edit      PUT  /api/facilities/:id
 *     activate  the is_active field carried by the same PUT (activate/deactivate)
 *     aliases   POST/PUT/DELETE /api/facilities/:id/alias… (and the suggestions list)
 *     resolveMapping  POST /validation-queue/assignment/facility(+/accept-suggestions)
 * Purely master data: none of this appears in any case-access decision.
 */
function facilityPermissions(user) {
  const admin = isAdmin(user);
  return {
    view: true,
    search: true,
    details: true,
    add: admin,
    edit: admin,
    activate: admin,
    aliases: admin,
    resolveMapping: admin,
  };
}

const EDIT_ACTIONS = new Set([ACTIONS.CASE_EDIT, ACTIONS.CASE_REFER, ACTIONS.CASE_ARCHIVE, ACTIONS.MATCH_RESOLVE]);

/**
 * Route guard for a case action: returns the case permissions, or throws an Error with
 * `status` (403) and a message that says WHY — "view only" when the user can see the
 * case but not change it (e.g. their resident was referred to another barangay), "not
 * assigned" when they cannot see it at all. Backend enforcement: never rely on the UI
 * hiding a button.
 */
function assertCaseAction(user, scope, action, record) {
  const perms = casePermissions(user, scope, record);
  if (can(user, scope, action, record)) return perms;
  let message;
  if (!perms.view) {
    message = 'This case is not assigned to your barangay.';
  } else if (EDIT_ACTIONS.has(action) && !perms.edit) {
    message = perms.basis === 'referred_out'
      ? `This case is view-only for your barangay: it was referred to ${record.responsible_barangay || 'another barangay'}, which now handles it.`
      : 'This case is view-only for your account.';
  } else if (action === ACTIONS.MATCH_RESOLVE) {
    message = 'This record has no pending match.';
  } else if (action === ACTIONS.CASE_REFER && record?.match_status === 'pending') {
    message = "Decide this record's possible match (Validation) before referring it.";
  } else {
    message = 'This action is not available for this case.';
  }
  throw Object.assign(new Error(message), { status: 403, code: perms.view ? 'VIEW_ONLY' : 'NOT_ASSIGNED' });
}

/** Single entry point for route guards. */
function can(user, scope, action, resource) {
  switch (action) {
    case ACTIONS.CASE_VIEW: return casePermissions(user, scope, resource).view;
    case ACTIONS.CASE_EDIT: return casePermissions(user, scope, resource).edit;
    case ACTIONS.CASE_REFER: return casePermissions(user, scope, resource).refer;
    case ACTIONS.CASE_ARCHIVE: return casePermissions(user, scope, resource).archive;
    case ACTIONS.MATCH_RESOLVE: return casePermissions(user, scope, resource).resolveMatch;
    case ACTIONS.REFERRAL_VIEW: return referralPermissions(user, scope, resource).view;
    case ACTIONS.REFERRAL_ACCEPT: return referralPermissions(user, scope, resource).accept;
    case ACTIONS.REFERRAL_REJECT: return referralPermissions(user, scope, resource).reject;
    case ACTIONS.REFERRAL_CANCEL: return referralPermissions(user, scope, resource).cancel;
    case ACTIONS.ISSUE_FIX: return issuePermissions(user, scope, resource).fix;
    case ACTIONS.ISSUE_EXCLUDE: return issuePermissions(user, scope, resource).exclude;
    case ACTIONS.LOCATION_ASSIGN: return validationPermissions(user).assignLocation;
    case ACTIONS.FACILITY_MAP: return validationPermissions(user).mapFacility;
    default: throw new Error(`Unknown permission action: ${action}`);
  }
}

module.exports = {
  ACTIONS, can, assertCaseAction, casePermissions, referralPermissions, issuePermissions,
  validationPermissions, facilityPermissions,
};
