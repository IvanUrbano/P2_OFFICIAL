require('dotenv').config();
const fs = require('fs');
const pool = require('./db');
const P = require('./tbinsight/pipeline');
const { getPopulationMap } = require('./tbinsight/populationService');

(async () => {
  try {
    const monthly = await pool.query('SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month');
    const bgy = await pool.query('SELECT name FROM barangays ORDER BY name');
    const names = bgy.rows.map(r => r.name);
    const { calendar, seriesByBarangay } = P.buildDenseSeries(monthly.rows, names);
    const popMapByYear = {};
    for (const y of [...new Set(calendar.map(m => Number(m.slice(0,4))))]) {
      popMapByYear[y] = await getPopulationMap(y);
    }

    const window = P._featureWindow(calendar.length);
    const out = [];
    for (let i = window; i < calendar.length; i++) {
      const neighborRisks = P._neighborRisksAt(seriesByBarangay, popMapByYear, i - 1);
      for (const name of names) {
        const months = seriesByBarangay[name];
        if (months.length <= i) continue;
        const year = Number(months[i].month.slice(0,4));
        const pop = P._popFor(popMapByYear, name, year);
        if (pop == null) continue;

        const row = P.buildFeatureRow({ name, t: i, seriesByBarangay, popMapByYear, window, neighborRisks, historicalBiasAvg: {} });
        const ann = (cases) => ((cases * 12) / pop) * 100000;

        // Label variants, all from data at or AFTER t (features are strictly before t).
        const fwd = (k) => {
          const slice = months.slice(i, i + k).map(m => m.case_count);
          return slice.length < k ? null : ann(slice.reduce((a,b)=>a+b,0) / slice.length);
        };
        out.push({
          barangay_name: name,
          month: months[i].month,
          t: i,
          features: row.features,
          inc_1m: ann(months[i].case_count),   // current: single month
          inc_fwd3: fwd(3),                    // forward 3-month mean
          inc_fwd6: fwd(6),                    // forward 6-month mean
          inc_fwd12: fwd(12),                  // forward 12-month mean
        });
      }
    }
    fs.writeFileSync('_tmp_rows.json', JSON.stringify({ window, calendar, rows: out }));
    console.log(`Exported ${out.length} rows, window=${window}, months=${calendar.length}`);
    const nn = (k) => out.filter(r => r[k] != null).length;
    console.log(`non-null labels -> 1m:${nn('inc_1m')} fwd3:${nn('inc_fwd3')} fwd6:${nn('inc_fwd6')} fwd12:${nn('inc_fwd12')}`);
  } catch (e) { console.error('ERROR:', e.message); }
  finally { await pool.end(); }
})();
