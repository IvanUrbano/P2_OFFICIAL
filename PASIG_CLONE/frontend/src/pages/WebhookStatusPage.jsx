import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from '../api/axios';

export default function WebhookStatusPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const response = await axios.get('/api/webhook/logs');
      setLogs(response.data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  const sendWebhook = async () => {
    if (!batchId) {
      setError('No batch ID provided');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await axios.post('/api/webhook/send', { batchId });
      setResult(response.data);
      fetchLogs();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send webhook');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Send to P2_OFFICIAL</h1>

      {/* Send Section */}
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Webhook Delivery</h2>

        {batchId ? (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Ready to send batch{' '}
              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{batchId.substring(0, 8)}...</span>
              {' '}to P2_OFFICIAL.
            </p>

            <button
              onClick={sendWebhook}
              disabled={sending}
              className="bg-green-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              {sending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <i className="ri-send-plane-line" />
                  Send Now
                </>
              )}
            </button>
          </>
        ) : (
          <div className="text-center py-6">
            <i className="ri-send-plane-line text-4xl text-gray-300 mb-3 block" />
            <p className="text-gray-500">No batch selected. Please validate data first.</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {result && (
          <div className={`mt-4 p-4 rounded-lg text-sm ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <p className="font-semibold">{result.message}</p>
            {result.status && <p className="mt-1">Status Code: {result.status}</p>}
          </div>
        )}
      </div>

      {/* Webhook Logs */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Webhook History</h2>

        {logs.length === 0 ? (
          <div className="text-center py-6">
            <i className="ri-history-line text-4xl text-gray-300 mb-3 block" />
            <p className="text-gray-500">No webhook history yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-gray-500 uppercase">Batch</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-gray-500 uppercase">Filename</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-gray-500 uppercase">Response</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-3 px-2 text-gray-700">{new Date(log.sent_at).toLocaleString()}</td>
                    <td className="py-3 px-2 font-mono text-xs text-gray-500">{log.batch_id?.substring(0, 8)}...</td>
                    <td className="py-3 px-2 text-gray-700">{log.filename}</td>
                    <td className="py-3 px-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        log.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-gray-500">{log.response_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
