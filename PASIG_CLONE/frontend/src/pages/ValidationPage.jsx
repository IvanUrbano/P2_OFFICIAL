import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from '../api/axios';

export default function ValidationPage() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  const navigate = useNavigate();

  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const validateBatch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`/api/data/validate/${batchId}`);
      setValidation(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Validation failed');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (batchId) {
      validateBatch();
    }
  }, [batchId, validateBatch]);

  if (!batchId) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Data Validation</h1>
        <div className="bg-white rounded-xl shadow-sm border p-6 text-center">
          <i className="ri-checkbox-circle-line text-4xl text-gray-300 mb-3 block" />
          <p className="text-gray-500">No batch selected. Please upload a file first.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Go to Import
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Data Validation</h1>

      {loading && (
        <div className="bg-white rounded-xl shadow-sm border p-10 text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Validating data...</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 text-sm rounded-lg mb-4">
          {error}
        </div>
      )}

      {validation && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
              <p className="text-2xl font-bold text-gray-900">{validation.summary.total}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-green-600 uppercase tracking-wide">Valid</p>
              <p className="text-2xl font-bold text-green-600">{validation.summary.valid}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-red-600 uppercase tracking-wide">Invalid</p>
              <p className="text-2xl font-bold text-red-600">{validation.summary.invalid}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-yellow-600 uppercase tracking-wide">Warnings</p>
              <p className="text-2xl font-bold text-yellow-600">{validation.summary.warnings}</p>
            </div>
          </div>

          {/* Errors */}
          {validation.errors.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-red-700 mb-3">Validation Errors</h2>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {validation.errors.map((err, idx) => (
                  <div key={idx} className="p-3 bg-red-50 rounded-lg text-sm">
                    <span className="font-mono text-red-800">Row {err.row}</span>
                    <span className="text-gray-500 mx-2">({err.source_type})</span>
                    <span className="text-red-600">{err.errors.join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Send Button */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Send to P2_OFFICIAL</h2>
            <p className="text-sm text-gray-600 mb-4">
              Send {validation.summary.valid} validated records to the main TBInsight system.
            </p>
            <button
              onClick={() => navigate(`/webhook?batchId=${batchId}`)}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              Continue to Send
              <i className="ri-arrow-right-line" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
