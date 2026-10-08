const { test } = require('node:test');
const assert = require('node:assert/strict');
const dbModule = require.resolve('../../db');
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: {} };
const { evaluateHotspotAlerts } = require('../../tbinsight/alertEngine');

test('hotspot summary stores every affected barangay for display and filtering', async () => {
  let savedMetadata;
  const db = {
    async query(sql, params) {
      if (sql.startsWith('DELETE FROM alerts')) return { rowCount: 0 };
      if (sql.includes('FROM barangay_risk_scores')) return { rows: [
        { barangay_name: 'Pinagbuhatan', risk_score: 75, incidence_per_100k: 826.5 },
        { barangay_name: 'Santa Rosa', risk_score: 63, incidence_per_100k: 1150.5 },
      ] };
      if (sql.startsWith('SELECT id FROM alerts')) return { rows: [] };
      if (sql.startsWith('INSERT INTO alerts')) {
        savedMetadata = JSON.parse(params[8]);
        return { rows: [{ id: 4 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const ids = await evaluateHotspotAlerts(db, '2026-10-01');
  assert.deepEqual(ids, [4]);
  assert.deepEqual(savedMetadata.affected_barangays, ['Pinagbuhatan', 'Santa Rosa']);
});
