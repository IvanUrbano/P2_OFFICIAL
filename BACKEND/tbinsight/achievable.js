/**
 * TBInsight — "best achievable" references for the model evaluation.
 *
 * A barangay records a handful of TB cases a month, and how many fall in a given
 * month is largely chance: even a forecaster that knew each barangay's true rate
 * exactly would still be off by that chance variation. These figures estimate the
 * score such a perfect model would get on the same months, so an evaluation can be
 * read against what the data allows rather than against 100%.
 *
 * The "true rate" of a barangay in a month is its average over the whole series
 * times the city's seasonal factor for that calendar month. It is computed from
 * all the data on purpose — it is the reference a model cannot see, not a forecast.
 */

const { LOW_PERCENTILE, MED_PERCENTILE } = require('./scoring');

function logFactorial(k) {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
}

/** E|Y − λ| for a Poisson count Y with mean λ: 2·e^−λ·λ^(⌊λ⌋+1) / ⌊λ⌋!. */
function poissonMeanAbsDeviation(lambda) {
  if (!(lambda > 0)) return 0;
  const k = Math.floor(lambda);
  return 2 * Math.exp(-lambda + (k + 1) * Math.log(lambda) - logFactorial(k));
}

/**
 * True monthly rate per barangay: whole-series mean × the city's seasonal factor.
 * @param {Object} seriesByBarangay - dense series from buildDenseSeries
 * @returns {Object} { name: { 'YYYY-MM-01': rate } }
 */
function trueRates(seriesByBarangay) {
  const names = Object.keys(seriesByBarangay);
  if (names.length === 0) return {};
  const months = seriesByBarangay[names[0]].map(p => p.month);
  const city = months.map((_, i) => names.reduce((s, n) => s + (seriesByBarangay[n][i]?.case_count || 0), 0));
  const cityMean = city.reduce((a, b) => a + b, 0) / (city.length || 1);
  const byCalendarMonth = {};
  months.forEach((m, i) => (byCalendarMonth[m.slice(5, 7)] ??= []).push(city[i]));
  const season = {};
  for (const [cm, vals] of Object.entries(byCalendarMonth)) {
    season[cm] = cityMean > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length / cityMean : 1;
  }
  const rates = {};
  for (const name of names) {
    const counts = seriesByBarangay[name].map(p => p.case_count);
    const mean = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
    rates[name] = Object.fromEntries(months.map(m => [m, mean * season[m.slice(5, 7)]]));
  }
  return rates;
}

/**
 * Average error a perfect forecaster would still make on the evaluated months.
 * @param {Array} perBarangay - [{barangay_name, steps: [{month}]}] as saved by the evaluation
 * @returns {number|null}
 */
function forecastErrorFloor(perBarangay, seriesByBarangay) {
  const rates = trueRates(seriesByBarangay);
  let sum = 0;
  let n = 0;
  for (const b of perBarangay || []) {
    for (const step of b.steps || []) {
      const rate = rates[b.barangay_name]?.[String(step.month).slice(0, 10)];
      if (rate == null) continue;
      sum += poissonMeanAbsDeviation(rate);
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

// Small seeded generator so the same data always gives the same figure.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonSample(lambda, rand) {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = rand();
    while (p > limit) { k += 1; p *= rand(); }
    return k;
  }
  const z = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

/** Low/Medium/High by rank within the set — the same rule as the RF labels. */
function bandsByRank(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const bands = new Array(values.length);
  order.forEach(([, i], rank) => {
    const q = values.length > 1 ? rank / (values.length - 1) : 0;
    bands[i] = q < LOW_PERCENTILE ? 0 : q >= MED_PERCENTILE ? 2 : 1;
  });
  return bands;
}

/**
 * Accuracy a perfect classifier would get on the risk-band labels of `labelMonths`:
 * how often the band of a barangay's TRUE rate matches the band its actual
 * (chance-varying) counts land in over the label window.
 *
 * @param {Object} seriesByBarangay
 * @param {Object} popMapByYear - {year: {name: {population, available}}}
 * @param {string[]} labelMonths - target months ('YYYY-MM-01') of the evaluated labels
 * @param {number} horizon - months averaged into one label
 * @returns {number|null}
 */
function riskBandCeiling(seriesByBarangay, popMapByYear, labelMonths, horizon, { draws = 300, seed = 1 } = {}) {
  const rates = trueRates(seriesByBarangay);
  const rand = mulberry32(seed);
  let agree = 0;
  let total = 0;
  for (const month of labelMonths || []) {
    const year = Number(month.slice(0, 4));
    const rows = [];
    for (const name of Object.keys(seriesByBarangay)) {
      const ref = popMapByYear?.[year]?.[name];
      if (!ref?.available || !(ref.population > 0)) continue;
      const months = seriesByBarangay[name].map(p => p.month);
      const start = months.indexOf(month);
      if (start < 0 || start + horizon > months.length) continue;
      const lambda = months.slice(start, start + horizon).reduce((s, m) => s + rates[name][m], 0);
      rows.push({ lambda, population: ref.population });
    }
    if (rows.length < 3) continue;
    const trueBands = bandsByRank(rows.map(r => r.lambda / r.population));
    for (let d = 0; d < draws; d++) {
      const drawn = bandsByRank(rows.map(r => poissonSample(r.lambda, rand) / r.population));
      drawn.forEach((b, i) => { if (b === trueBands[i]) agree += 1; });
      total += rows.length;
    }
  }
  return total > 0 ? agree / total : null;
}

/** Share of predictions that put a Low barangay in High or a High one in Low. */
function lowHighConfusion(confusionMatrix) {
  if (!confusionMatrix) return null;
  const cells = Object.values(confusionMatrix).flatMap(row => Object.values(row));
  const total = cells.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return ((confusionMatrix.Low?.High || 0) + (confusionMatrix.High?.Low || 0)) / total;
}

module.exports = {
  poissonMeanAbsDeviation,
  trueRates,
  forecastErrorFloor,
  riskBandCeiling,
  lowHighConfusion,
  bandsByRank,
};
