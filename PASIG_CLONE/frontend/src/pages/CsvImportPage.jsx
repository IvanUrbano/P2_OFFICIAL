import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../api/axios';

export default function CsvImportPage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/data/csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Import TB Data</h1>

      <div className="bg-white rounded-xl shadow-sm border p-6">
        <p className="text-sm text-gray-600 mb-4">
          Upload an Excel file exported from the DOH TB-DOTS registry.
          The file should contain two sheets: DSTB and MN.
        </p>

        <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files[0])}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <div className="text-gray-400 mb-3">
              <i className="ri-upload-cloud-2-line text-5xl" />
            </div>
            <p className="text-gray-700 font-medium">
              {file ? file.name : 'Click to select file'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB`
                : 'Supports .xlsx, .xls (max 50MB)'}
            </p>
          </label>
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="mt-4 w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload File'}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 bg-green-50 text-green-700 text-sm rounded-lg">
            <p className="font-semibold text-green-800 mb-2">Upload Successful!</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="text-green-600">Batch ID:</span> <span className="font-mono text-xs">{result.batch.id?.substring(0, 8)}...</span></p>
              <p><span className="text-green-600">Total Records:</span> {result.batch.totalRows}</p>
              <p><span className="text-green-600">DSTB Records:</span> {result.batch.dstbCount}</p>
              <p><span className="text-green-600">MN Records:</span> {result.batch.mnCount}</p>
            </div>

            <button
              onClick={() => navigate(`/validate?batchId=${result.batch.id}`)}
              className="mt-4 inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              Go to Validation
              <i className="ri-arrow-right-line" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
