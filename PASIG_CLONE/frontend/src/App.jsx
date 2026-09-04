import React, { useState, useEffect, useCallback } from 'react';

function ImportPage({ onImport }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [dragover, setDragover] = useState(false);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragover(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile);
    }
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      setResult(data);
      onImport();
    } catch (err) {
      setResult({ error: err.message });
    }
    setUploading(false);
  };

  return (
    <div className="card">
      <h2>Import Excel File</h2>
      <div
        className={`upload-zone ${dragover ? 'dragover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
        onDragLeave={() => setDragover(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0])}
        />
        {file ? (
          <p>Selected: <strong>{file.name}</strong></p>
        ) : (
          <p>Drop Excel file here or click to select</p>
        )}
      </div>
      <button
        style={{ marginTop: 15 }}
        disabled={!file || uploading}
        onClick={handleUpload}
      >
        {uploading ? 'Processing...' : 'Import'}
      </button>
      {result && !result.error && (
        <div className="results">
          <h3>Import Results</h3>
          <div className="row"><span>File</span><span>{result.file}</span></div>
          <div className="row"><span>DSTB Total</span><span>{result.stats.DSTB.total}</span></div>
          <div className="row"><span>DSTB Valid</span><span>{result.stats.DSTB.valid}</span></div>
          <div className="row"><span>MN Total</span><span>{result.stats.MN.total}</span></div>
          <div className="row"><span>MN Valid</span><span>{result.stats.MN.valid}</span></div>
          {result.stats.DSTB.errors.length > 0 && (
            <div className="error">
              DSTB Errors: {result.stats.DSTB.errors.map((e, i) => `Row ${e.row}: ${e.errors.join(', ')}`).join('; ')}
            </div>
          )}
          {result.stats.MN.errors.length > 0 && (
            <div className="error">
              MN Errors: {result.stats.MN.errors.map((e, i) => `Row ${e.row}: ${e.errors.join(', ')}`).join('; ')}
            </div>
          )}
        </div>
      )}
      {result && result.error && (
        <div className="results error">{result.error}</div>
      )}
    </div>
  );
}

function CasesPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cases')
      .then(r => r.json())
      .then(data => { setCases(data); setLoading(false); });
  }, []);

  if (loading) return <div className="card"><p>Loading...</p></div>;

  return (
    <div className="card">
      <h2>Imported Cases ({cases.length})</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="cases-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Dataset</th>
              <th>Patient No</th>
              <th>ITIS Case ID</th>
              <th>Date Reported</th>
              <th>Facility</th>
              <th>Barangay</th>
              <th>Sex</th>
              <th>Age</th>
              <th>Outcome</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {cases.map(c => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td><span className={`badge ${c.dataset.toLowerCase()}`}>{c.dataset}</span></td>
                <td>{c.patient_no || '-'}</td>
                <td>{c.itis_case_id || '-'}</td>
                <td>{c.date_reported || '-'}</td>
                <td>{c.facility_name || '-'}</td>
                <td>{c.barangay || '-'}</td>
                <td>{c.sex || '-'}</td>
                <td>{c.age || '-'}</td>
                <td>{c.outcome || '-'}</td>
                <td><span className={`badge ${c.webhook_sent ? 'sent' : 'pending'}`}>{c.webhook_sent ? 'Sent' : 'Pending'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WebhookPage({ onSend }) {
  const [stats, setStats] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats);
  }, []);

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/webhook/send', { method: 'POST' });
      const data = await res.json();
      setResult(data);
      fetch('/api/stats').then(r => r.json()).then(setStats);
      onSend();
    } catch (err) {
      setResult({ error: err.message });
    }
    setSending(false);
  };

  return (
    <div className="card">
      <h2>Send to TBInsight</h2>
      {stats && (
        <div className="stats-grid">
          <div className="stat-box">
            <div className="value">{stats.total}</div>
            <div className="label">Total Cases</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.pending}</div>
            <div className="label">Pending</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.sent}</div>
            <div className="label">Sent</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.byDataset.DSTB}</div>
            <div className="label">DSTB</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.byDataset.MN}</div>
            <div className="label">MN</div>
          </div>
        </div>
      )}
      <button
        className="secondary"
        disabled={sending || (stats && stats.pending === 0)}
        onClick={handleSend}
      >
        {sending ? 'Sending...' : 'Send Pending Cases'}
      </button>
      {result && (
        <div className="results">
          <h3>Webhook Result</h3>
          <div className="row"><span>Status</span><span>{result.message}</span></div>
          {result.sent > 0 && <div className="row"><span>Sent</span><span>{result.sent} cases</span></div>}
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('import');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey(k => k + 1);

  return (
    <div className="app">
      <header>
        <h1>Pasig TB-DOTS Integration</h1>
        <p>Import, validate, and send TB case data to TBInsight</p>
      </header>

      <nav style={{ marginBottom: 20, display: 'flex', gap: 10 }}>
        <button onClick={() => setActiveTab('import')}>Import</button>
        <button onClick={() => setActiveTab('cases')}>Cases</button>
        <button onClick={() => setActiveTab('webhook')}>Send to TBInsight</button>
      </nav>

      {activeTab === 'import' && <ImportPage onImport={refresh} />}
      {activeTab === 'cases' && <CasesPage key={refreshKey} />}
      {activeTab === 'webhook' && <WebhookPage onSend={refresh} />}
    </div>
  );
}

export default App;
