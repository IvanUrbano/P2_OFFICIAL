/**
 * Centralized permission check for the UI.
 *
 * The server decides every permission (backend/policies/permissions.js) and attaches a
 * `permissions` object to each resource it returns — cases, referrals, data issues and
 * the validation queue. Components only ask `can(resource, action)`; they never compare
 * roles, barangays or facilities themselves, so the UI and the API cannot disagree.
 *
 * Actions by resource:
 *   case       view · edit · refer · archive · resolveMatch   (+ basis: primary / referred_in / referred_out / admin)
 *   referral   view · viewCase · accept · reject · cancel     (+ direction: incoming / outgoing)
 *   issue      fix · exclude
 *   queue      assignLocation · mapFacility
 */
export const can = (resource, action) => Boolean(resource?.permissions?.[action]);

/** Why the user can see a case: 'admin' | 'primary' | 'referred_in' | 'referred_out' | null. */
export const accessBasis = (resource) => resource?.permissions?.basis ?? null;
