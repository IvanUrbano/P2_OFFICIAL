require('dotenv').config();
const pool = require('./db');
const P = require('./tbinsight/pipeline');
const { getPopulationMap } = require('./tbinsight/populationService');
const { mlPost, healthCheck } = require('./tbinsight/mlClient');

(async () => {
  try {
    for (let i = 0; i < 12 && !(await healthCheck()); i++) await new Promise(r => setTimeout(r, 3000));
    console.log('ML service healthy:', await healthCheck());

    const monthly = await pool.query('SELECT barangay_name, month, case_count FROM monthly_case_summary ORDER BY month');
    const bgy = await pool.query('SELECT name FROM barangays ORDER BY name');
    const names = bgy.rows.map(r => r.name);
    const { calendar, seriesByBarangay } = P.buildDenseSeries(monthly.rows, names);
    const popMapByYear = {};
    for (const y of [...new Set(calendar.map(m=>Number(m.slice(0,4))))]) popMapByYear[y] = await getPopulationMap(y);

    const trainRows = P.buildTrainingRows(seriesByBarangay, popMapByYear, {});
    console.log(`Training rows: ${trainRows.length} (was 720 with single-month labels)`);
    console.log(`Rows carry month: ${trainRows.every(r => r.month) ? 'yes' : 'NO'}`);

    const barangayIncidences = names.map(n => {
      const pts = seriesByBarangay[n].slice().sort((a,c)=>a.month.localeCompare(c.month));
      const last = pts[pts.length-1];
      const pop = P._popFor(popMapByYear, n, Number(last.month.slice(0,4)));
      return { name:n, incidence_per_100k: pop ? ((last.case_count*12)/pop)*100000 : null };
    });
    const maxLen = Math.max(...names.map(n=>seriesByBarangay[n].length));
    const w = P._featureWindow(maxLen);
    const nr = P._neighborRisksAt(seriesByBarangay, popMapByYear, maxLen-1);
    const predictRows = names.map(n => P.buildFeatureRow({
      name:n, t:seriesByBarangay[n].length, seriesByBarangay, popMapByYear, window:w, neighborRisks:nr, historicalBiasAvg:{} }));
    const { thresholds } = await P._resolveThresholds({ barangayIncidences, predictRows });

    const res = await mlPost('/evaluate', {
      series: Object.values(seriesByBarangay).flat(), train: trainRows, thresholds, min_train: 30*12,
    });
    const rf = res.rf;
    console.log('\n=== RF WALK-FORWARD (after changes) ===');
    console.log(`steps=${rf.n_steps} accuracy=${(rf.accuracy*100).toFixed(1)}% f1_macro=${rf.f1_macro}`);
    console.log('precision:', JSON.stringify(rf.precision));
    console.log('recall   :', JSON.stringify(rf.recall));
    if (rf.confusion_matrix) { console.log('\nConfusion matrix (rows=actual, cols=predicted):'); console.table(rf.confusion_matrix); }

    // Balance check: labels should now be ~1/3 each.
    const steps = rf.steps || [];
    const allActual = steps.flatMap(s => s.actual);
    const bal = allActual.reduce((a,c)=>(a[c]=(a[c]||0)+1,a),{});
    const tot = allActual.length;
    console.log('\nLabel balance in test window:',
      Object.entries(bal).map(([k,v])=>`${k} ${(100*v/tot).toFixed(1)}%`).join('  '));
    const maj = Math.max(...Object.values(bal))/tot;
    console.log(`Majority-class baseline: ${(maj*100).toFixed(1)}%  ->  LIFT = ${((rf.accuracy-maj)*100).toFixed(1)} points`);
  } catch (e) { console.error('ERROR:', e.message); }
  finally { await pool.end(); }
})();
