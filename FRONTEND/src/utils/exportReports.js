// jspdf/xlsx/file-saver are loaded on demand (dynamic import) instead of at module load —
// they're only needed when someone actually exports, not on every visit to the Reports page.
let pdfPluginApplied = false;

export async function exportCSV(cases) {
  if (!cases?.length) return;
  const { saveAs } = await import('file-saver');
  const headers = ['Case ID', 'Date', 'Barangay', 'Sex', 'Age', 'Registration Group', 'Anatomical Site', 'Case Status', 'Treatment Outcome', 'Source Outcome Value', 'Bacteriological Status'];
  const rows = cases.map(r => [
    r.source_case_id || 'No Case ID',
    r.date_of_diagnosis ? new Date(r.date_of_diagnosis).toLocaleDateString('en-US') : '',
    r.barangay_name || '',
    r.sex || '',
    r.age ?? '',
    r.registration_group || '',
    r.anatomical_site || '',
    r.case_status || '',
    r.outcome_status || '',
    r.source_outcome_status || '',
    r.bacteriological_status || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `TBInsight_Report_${new Date().toISOString().slice(0, 10)}.csv`);
}

export async function exportExcel(report, reportData) {
  if (!report) return;
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // One sheet block-by-block, so the workbook says exactly what the on-screen report says.
  const sheetRows = [[report.headerTitle], [report.subtitle], []];
  for (const block of report.blocks) {
    sheetRows.push([block.title.toUpperCase()]);
    if (block.kind === 'kv') block.rows.forEach(r => sheetRows.push(r));
    else if (block.kind === 'table') {
      sheetRows.push(block.headers);
      if (block.rows.length) block.rows.forEach(r => sheetRows.push(r));
      else sheetRows.push([block.emptyText || 'No data available for this period.']);
    } else block.items.forEach((t, i) => sheetRows.push([block.kind === 'list' ? `${i + 1}. ${t}` : t]));
    sheetRows.push([]);
  }
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 52 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Report');

  // Record-level detail for the same period and coverage
  const cases = reportData?.cases || [];
  if (cases.length) {
    const recordHeaders = ['Case ID', 'Date of Diagnosis', 'Barangay', 'Sex', 'Age', 'Registration Group', 'Anatomical Site', 'Bacteriological Status', 'Case Status', 'Treatment Outcome', 'Source Outcome Value'];
    const recordRows = cases.map(r => [
      r.source_case_id || 'No Case ID',
      r.date_of_diagnosis ? new Date(r.date_of_diagnosis).toLocaleDateString('en-US') : '',
      r.barangay_name || '',
      r.sex || '',
      r.age ?? '',
      r.registration_group || '',
      r.anatomical_site || '',
      r.bacteriological_status || '',
      r.case_status || '',
      r.outcome_status || '',
      r.source_outcome_status || '',
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([recordHeaders, ...recordRows]), 'TB Records');
  }

  XLSX.writeFile(wb, `TBInsight_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportPDF(report) {
  if (!report) return;
  const { default: jsPDF } = await import('jspdf');
  if (!pdfPluginApplied) {
    const { applyPlugin } = await import('jspdf-autotable');
    applyPlugin(jsPDF);
    pdfPluginApplied = true;
  }
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  const NAVY = [15, 45, 82];
  const GRAY = [107, 114, 128];
  const BLACK = [17, 24, 39];

  function checkPage(needed) {
    if (y + needed > pageHeight - 25) {
      doc.addPage();
      y = 15;
    }
  }

  function addHeader() {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text('Republic of the Philippines', pageWidth / 2, y, { align: 'center' });
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BLACK);
    doc.text('Pasig City Health Office', pageWidth / 2, y, { align: 'center' });
    y += 3;
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...NAVY);
    doc.text(report.headerTitle || 'TUBERCULOSIS REPORT', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(report.subtitle || '', pageWidth / 2, y, { align: 'center' });
    y += 3;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  }

  function addSectionTitle(title) {
    checkPage(16);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...NAVY);
    doc.text(title, margin, y);
    y += 2;
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
  }

  function addTable(headers, rows, textColumns = [0]) {
    checkPage(20);
    const columnStyles = {};
    headers.forEach((_, i) => { if (!textColumns.includes(i)) columnStyles[i] = { halign: 'right' }; });
    doc.autoTable({
      startY: y,
      head: [headers],
      body: rows,
      columnStyles,
      theme: 'grid',
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: BLACK },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { cellPadding: 3, lineWidth: 0.1, lineColor: [200, 200, 200] },
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  function addKeyValueTable(rows) {
    checkPage(16);
    doc.autoTable({
      startY: y,
      body: rows.map(([k, v]) => [
        { content: k, styles: { fontStyle: 'normal', textColor: GRAY, cellWidth: contentWidth * 0.5 } },
        { content: String(v), styles: { fontStyle: 'bold', textColor: BLACK, halign: 'right' } },
      ]),
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  function addFooter() {
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(...GRAY);
      doc.text(`TBInsight \u00B7 Pasig City Health Office \u00B7 ${report.footerPeriod || ''}${report.reportRef ? ` · Ref ${report.reportRef}` : ''}`, margin, pageHeight - 10);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
    }
  }

  // ── Build PDF ──

  addHeader();

  for (const block of report.blocks) {
    addSectionTitle(block.title);
    if (block.kind === 'kv') {
      addKeyValueTable(block.rows);
    } else if (block.kind === 'table') {
      if (block.rows.length === 0) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...GRAY);
        doc.text(block.emptyText || 'No data available for this period.', margin, y);
        y += 8;
      } else {
        addTable(block.headers, block.rows.map(r => r.map(String)), block.textColumns || [0]);
      }
    } else {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...BLACK);
      block.items.forEach((item, i) => {
        const lines = doc.splitTextToSize(block.kind === 'list' ? `${i + 1}. ${item}` : item, contentWidth);
        checkPage(lines.length * 4 + 4);
        lines.forEach(line => { doc.text(line, margin, y); y += 4; });
        y += 2;
      });
      y += 4;
    }
  }

  // Signature block
  checkPage(30);
  y += 6;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;
  const sigWidth = contentWidth / 2 - 10;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...BLACK);
  // Prepared by
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  if (report.preparedBy) doc.text(report.preparedBy, margin, y - 1.5);
  doc.line(margin, y, margin + sigWidth, y);
  y += 4;
  doc.text('Prepared by', margin, y);
  // Noted by
  const notedX = pageWidth / 2 + 10;
  doc.line(notedX, y - 4, notedX + sigWidth, y - 4);
  doc.text('Noted by', notedX, y);

  addFooter();

  doc.save(`TBInsight_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function printReport() {
  const report = document.getElementById('printable-report');
  if (!report) return;

  const hidden = [];
  let current = report;

  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (parent) {
      Array.from(parent.children).forEach(sibling => {
        if (sibling !== current && !sibling.contains(report) && sibling !== report) {
          sibling.style.setProperty('display', 'none', 'important');
          hidden.push(sibling);
        }
      });
    }
    current = parent;
  }

  window.print();

  const restore = () => {
    hidden.forEach(e => e.style.removeProperty('display'));
  };
  window.addEventListener('afterprint', restore, { once: true });
  setTimeout(restore, 5000);
}

export function saveToRecentReports(reportData, filters = {}) {
  const key = 'tbinsight_recent_reports';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  const entry = {
    id: `rpt_${Date.now()}`,
    type: reportData.report?.type || 'Report',
    period: reportData.report?.period || '',
    coverage: reportData.report?.coverage || '',
    generatedAt: reportData.report?.generatedAt || new Date().toISOString(),
    generatedBy: reportData.report?.generatedBy || null,
    filters: {
      reportType: filters.reportType || reportData.report?.type || 'monthly',
      year: filters.year || '',
      month: filters.month || '',
      quarter: filters.quarter || '',
      barangay: filters.barangay || '',
    },
  };
  const updated = [entry, ...existing].slice(0, 20);
  localStorage.setItem(key, JSON.stringify(updated));
  return updated;
}

export function getRecentReports() {
  return JSON.parse(localStorage.getItem('tbinsight_recent_reports') || '[]');
}

export function deleteRecentReport(id) {
  const key = 'tbinsight_recent_reports';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  const updated = existing.filter(r => r.id !== id);
  localStorage.setItem(key, JSON.stringify(updated));
  return updated;
}
