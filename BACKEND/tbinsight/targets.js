/**
 * Programme targets shared by the alerts and the report recommendations, so they always
 * judge a figure against the same number. No database access: safe to require from pure
 * modules and tests.
 */

// Treatment Success Rate (%) at or above this is on target.
const TREATMENT_SUCCESS_TARGET = 85;

module.exports = { TREATMENT_SUCCESS_TARGET };
