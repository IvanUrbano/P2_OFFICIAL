const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

process.env.ML_HEALTH_RETRY_DELAY_MS = '0';
process.env.ML_API_KEY = process.env.ML_API_KEY || 'test-key';
const { healthCheck } = require('../../tbinsight/mlClient');

const ok = () => ({ ok: true, status: 200, json: async () => ({ status: 'ok' }) });
const notFound = () => ({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) });
const timeout = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };

describe('healthCheck', () => {
  let realFetch;
  let warnings;
  beforeEach(() => {
    realFetch = global.fetch;
    warnings = [];
    mock.method(console, 'warn', msg => warnings.push(msg));
  });
  afterEach(() => {
    global.fetch = realFetch;
    mock.restoreAll();
  });

  it('is healthy on the first answer without logging', async () => {
    global.fetch = async () => ok();
    assert.strictEqual(await healthCheck(), true);
    assert.strictEqual(warnings.length, 0);
  });

  it('retries once, so a slow cold start does not fail the pipeline', async () => {
    let calls = 0;
    global.fetch = async () => (++calls === 1 ? timeout() : ok());
    assert.strictEqual(await healthCheck(), true);
    assert.strictEqual(calls, 2);
    assert.match(warnings[0], /attempt 1\/2.*timed out/);
  });

  it('gives up after the retry and logs each reason', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return notFound(); };
    assert.strictEqual(await healthCheck(), false);
    assert.strictEqual(calls, 2);
    assert.strictEqual(warnings.length, 2);
    assert.match(warnings[1], /attempt 2\/2.*HTTP 404/);
  });

  it('reports connection errors by their code', async () => {
    global.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
    assert.strictEqual(await healthCheck({ retries: 0 }), false);
    assert.match(warnings[0], /ENOTFOUND/);
  });
});
