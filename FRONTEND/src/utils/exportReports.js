import jsPDF from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
applyPlugin(jsPDF);
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export function exportCSV(cases) {
  if (!cases?.length) return;
  const headers = ['Case ID', 'Date', 'Barangay', 'Sex', 'Age', 'Registration Group', 'Anatomical Site', 'Outcome', 'Bacteriological Status'];
  const rows = cases.map(r => [
    r.id,
    r.date_of_diagnosis ? new Date(r.date_of_diagnosis).toLocaleDateString('en-US') : '',
    r.barangay_name || '',
    r.sex || '',
    r.age ?? '',
    r.registration_group || '',
    r.anatomical_site || '',
    r.outcome_status || '',
    r.bacteriological_status || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `TBInsight_Report_${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportExcel(reportData) {
  if (!reportData) return;
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryRows = [
    ['Report Type', reportData.report?.type || ''],
    ['Reporting Period', reportData.report?.period || ''],
    ['Coverage', reportData.report?.coverage || ''],
    ['Generated', reportData.report?.generatedAt ? new Date(reportData.report.generatedAt).toLocaleString() : ''],
    [],
    ['Total Cases', reportData.summary?.totalCases ?? ''],
    ['Active Cases', reportData.summary?.activeCases ?? ''],
    ['Treatment Success Rate', reportData.summary?.successRate != null ? `${reportData.summary.successRate}%` : 'N/A'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // TB Records sheet
  if (reportData.cases?.length) {
    const recordHeaders = ['Case ID', 'Date', 'Barangay', 'Sex', 'Age', 'Registration Group', 'Outcome'];
    const recordRows = reportData.cases.map(r => [
      r.id,
      r.date_of_diagnosis ? new Date(r.date_of_diagnosis).toLocaleDateString('en-US') : '',
      r.barangay_name || '',
      r.sex || '',
      r.age ?? '',
      r.registration_group || '',
      r.outcome_status || '',
    ]);
    const wsRecords = XLSX.utils.aoa_to_sheet([recordHeaders, ...recordRows]);
    XLSX.utils.book_append_sheet(wb, wsRecords, 'TB Records');
  }

  // Treatment Outcomes sheet
  if (reportData.outcomes?.length) {
    const outcomeHeaders = ['Outcome', 'Count', 'Percentage'];
    const outcomeRows = reportData.outcomes.map(r => [r.outcome_status, r.count, `${r.percentage}%`]);
    const wsOutcomes = XLSX.utils.aoa_to_sheet([outcomeHeaders, ...outcomeRows]);
    XLSX.utils.book_append_sheet(wb, wsOutcomes, 'Treatment Outcomes');
  }

  // Barangay Analysis sheet
  if (reportData.barangayDistribution?.length) {
    const brgyHeaders = ['Barangay', 'Cases', 'Population', 'Incidence Rate'];
    const brgyRows = reportData.barangayDistribution.map(r => [r.barangay, r.cases, r.population, r.incidence != null ? `${r.incidence}/100k` : 'N/A']);
    const wsBrgy = XLSX.utils.aoa_to_sheet([brgyHeaders, ...brgyRows]);
    XLSX.utils.book_append_sheet(wb, wsBrgy, 'Barangay Analysis');
  }

  // Forecast sheet
  if (reportData.forecast?.available) {
    const fcHeaders = ['Forecasted Cases', 'Forecast Period'];
    const fcRows = [[reportData.forecast.forecastedCases, reportData.forecast.period]];
    const wsFc = XLSX.utils.aoa_to_sheet([fcHeaders, ...fcRows]);
    XLSX.utils.book_append_sheet(wb, wsFc, 'Forecast');
  }

  XLSX.writeFile(wb, `TBInsight_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportPDF(report) {
  if (!report) return;
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

  function addTable(headers, rows) {
    checkPage(20);
    doc.autoTable({
      startY: y,
      head: [headers],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: BLACK },
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
      doc.text(`TBInsight \u00B7 Pasig City Health Office \u00B7 ${report.footerPeriod || ''}`, margin, pageHeight - 10);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
    }
  }

  // ── Build PDF ──

  addHeader();

  // Summary KPIs
  if (report.kpis?.length > 0) {
    addSectionTitle('Summary');
    const kpiRows = report.kpis.map(k => [k.label, String(k.value)]);
    addKeyValueTable(kpiRows);
  }

  // Treatment Outcomes
  if (report.tables?.length > 0) {
    for (const table of report.tables) {
      addSectionTitle(table.title);
      addTable(table.headers, table.rows);
    }
  }

  // Sex Distribution
  if (report.sideBySide?.length > 0) {
    for (const section of report.sideBySide) {
      addSectionTitle(section.title);
      addTable(section.headers, section.rows);
    }
  }

  // Age Distribution
  if (report.ageGroups?.length > 0) {
    addSectionTitle('Age Distribution');
    addTable(
      ['Age Group', 'Count', 'Percentage'],
      report.ageGroups.map(r => [r.age_group, String(r.count), `${r.percentage}%`])
    );
  }

  // Case Profile
  if (report.caseProfile) {
    addSectionTitle('Case Profile');
    addKeyValueTable([
      ['New Cases', String(report.caseProfile.newCases)],
      ['Relapse / Recapture', String(report.caseProfile.relapse)],
      ['Pulmonary', String(report.caseProfile.pulmonary)],
      ['Extra-pulmonary', String(report.caseProfile.extraPulmonary)],
    ]);
  }

  // Forecast
  if (report.forecast?.available) {
    addSectionTitle('Forecast');
    addKeyValueTable([
      ['Forecasted Cases', String(report.forecast.forecastedCases)],
      ['Forecast Period', report.forecast.period || ''],
    ]);
  }

  // TB Case Trend
  if (report.trend?.length > 0) {
    addSectionTitle('TB Case Trend');
    addTable(
      ['Month', 'Cases'],
      report.trend.map(r => [r.label, String(r.cases)])
    );
  }

  // Barangay Distribution
  if (report.barangayDistribution?.length > 0) {
    addSectionTitle('TB Cases by Barangay');
    addTable(
      ['Barangay', 'Cases'],
      report.barangayDistribution.map(r => [r.barangay, String(r.cases)])
    );
  }

  // Recommendations
  if (report.recommendations?.length > 0) {
    addSectionTitle('Recommendations');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BLACK);
    report.recommendations.forEach((rec, i) => {
      checkPage(10);
      const lines = doc.splitTextToSize(`${i + 1}. ${rec}`, contentWidth);
      lines.forEach(line => {
        doc.text(line, margin, y);
        y += 4;
      });
      y += 2;
    });
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
  window.print();
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
