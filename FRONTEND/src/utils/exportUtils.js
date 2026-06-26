/**
 * Convert an array of objects to a CSV string.
 * Handles quoting for values that contain commas, quotes, or newlines.
 * @param {Array<Object>} rows - Array of row objects
 * @returns {string} CSV string
 */
export function toCSV(rows) {
  if (!rows || rows.length === 0) return '';

  const headers = Object.keys(rows[0]);

  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.map(escapeCell).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCell(row[h])).join(',')
  );

  return [headerLine, ...dataLines].join('\r\n');
}

/**
 * Trigger a file download in the browser.
 * @param {string} content - File content
 * @param {string} filename - Filename including extension
 * @param {string} mimeType - MIME type (defaults to text/csv)
 */
export function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
