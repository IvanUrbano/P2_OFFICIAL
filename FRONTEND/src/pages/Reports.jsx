import { useState, useCallback } from 'react';
import API from '../api/axios';
import {
  exportPDF, printReport,
  saveToRecentReports, getRecentReports, deleteRecentReport,
} from '../utils/exportReports';

/* ─── Constants ──────────────────────────────────────────────────────── */

const BARANGAYS = [
  'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan',
  'Dela Paz', 'Kalawaan', 'Kapasigan', 'Kapitolyo', 'Malinao',
  'Manggahan', 'Maybunga', 'Oranbo', 'Palatiw', 'Pinagbuhatan',
  'Pineda', 'Rosario', 'Sagad', 'San Antonio', 'San Joaquin',
  'San Jose', 'San Miguel', 'San Nicolas', 'Santa Cruz', 'Santa Lucia',
  'Santa Rosa', 'Santo Tomas', 'Santolan', 'Sumilang', 'Ugong',
];

const MONTH_OPTIONS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' }, { value: '4', label: 'April' },
  { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' },
  { value: '9', label: 'September' }, { value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const YEARS = ['2020', '2021', '2022', '2023', '2024', '2025', '2026'];

const QUARTER_OPTIONS = [
  { value: '1', label: 'Q1 \u2014 January\u2013March' },
  { value: '2', label: 'Q2 \u2014 April\u2013June' },
  { value: '3', label: 'Q3 \u2014 July\u2013September' },
  { value: '4', label: 'Q4 \u2014 October\u2013December' },
];

const REPORT_TYPES = [
  { key: 'monthly', title: 'Monthly', desc: 'City-wide or per barangay' },
  { key: 'quarterly', title: 'Quarterly', desc: 'Quarter summary and trends' },
  { key: 'annual', title: 'Annual', desc: 'Full-year case analysis' },
  { key: 'barangay', title: 'Barangay', desc: 'Per-barangay detail view' },
];

/* ─── Helper Components ──────────────────────────────────────────────── */

function FilterSelect({ label, value, onChange, children }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none" style={{ color: '#94A3B8' }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg pr-7 py-[7px] text-[11px] font-semibold outline-none transition cursor-pointer appearance-none"
        style={{
          background: '#ffffff',
          color: '#0F2D52',
          border: '1px solid #E2E8F0',
          paddingLeft: `${(label.length * 6.5) + 24}px`,
        }}
      >
        {children}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: '#64748B' }} />
    </div>
  );
}

function SkeletonBlock({ className }) {
  return <div className={`animate-pulse rounded-lg ${className}`} style={{ background: '#E2E8F0' }} />;
}

/* ─── Report Builders ────────────────────────────────────────────────── */

function buildMonthlyReport(data, barangay, month, year) {
  const { summary, outcomes, demographics, trend, barangayDistribution, recommendations, cases, caseProfile, forecast } = data;
  const monthName = MONTH_OPTIONS.find(m => m.value === month)?.label || month;
  const isCitywide = !barangay;

  return {
    type: 'monthly',
    title: `Monthly TB Report \u2014 ${monthName} ${year}${barangay ? ' \u00B7 ' + barangay : ' \u00B7 City-wide'}`,
    headerTitle: 'TUBERCULOSIS MONTHLY REPORT',
    subtitle: `${monthName} ${year}  \u00B7  ${isCitywide ? 'City-wide' : barangay}`,
    footerPeriod: `Report Period: ${monthName} ${year}`,
    kpis: [
      { label: 'Total Cases', value: summary.totalCases },
      { label: 'Active Cases', value: summary.activeCases },
      { label: 'Success Rate', value: summary.successRate != null ? `${summary.successRate}%` : 'N/A' },
    ],
    tables: [
      {
        title: 'TREATMENT OUTCOME BREAKDOWN',
        headers: ['Outcome', 'Count', 'Percentage'],
        rows: outcomes?.map(o => [o.outcome_status, o.count, `${o.percentage}%`]) || [],
      },
    ],
    sideBySide: [
      {
        title: 'SEX DISTRIBUTION',
        headers: ['Sex', 'Count', 'Percentage'],
        rows: demographics?.sex?.map(s => [s.sex, s.count, `${s.percentage}%`]) || [],
      },
    ],
    ageGroups: demographics?.ageGroups,
    caseProfile,
    forecast,
    trend,
    barangayDistribution: isCitywide ? barangayDistribution : null,
    recommendations,
    cases,
  };
}

function buildQuarterlyReport(data, quarter, year) {
  const { summary, outcomes, demographics, trend, barangayDistribution, recommendations, cases, caseProfile, forecast } = data;
  const qLabel = QUARTER_OPTIONS.find(q => q.value === quarter)?.label || `Q${quarter}`;

  return {
    type: 'quarterly',
    title: `Quarterly TB Report \u2014 ${qLabel} ${year}`,
    headerTitle: 'TUBERCULOSIS QUARTERLY REPORT',
    subtitle: `${qLabel} ${year}`,
    footerPeriod: `Report Period: ${qLabel} ${year}`,
    kpis: [
      { label: 'Total Cases', value: summary.totalCases },
      { label: 'Active Cases', value: summary.activeCases },
      { label: 'Success Rate', value: summary.successRate != null ? `${summary.successRate}%` : 'N/A' },
    ],
    tables: [
      {
        title: `TREATMENT OUTCOME BREAKDOWN \u2014 ${qLabel} ${year}`,
        headers: ['Outcome', 'Count', 'Percentage'],
        rows: outcomes?.map(o => [o.outcome_status, o.count, `${o.percentage}%`]) || [],
      },
    ],
    sideBySide: [
      {
        title: 'SEX DISTRIBUTION',
        headers: ['Sex', 'Count', 'Percentage'],
        rows: demographics?.sex?.map(s => [s.sex, s.count, `${s.percentage}%`]) || [],
      },
    ],
    ageGroups: demographics?.ageGroups,
    caseProfile,
    forecast,
    trend,
    barangayDistribution,
    recommendations,
    cases,
  };
}

function buildAnnualReport(data, year) {
  const { summary, outcomes, demographics, trend, barangayDistribution, recommendations, cases, caseProfile, forecast } = data;

  return {
    type: 'annual',
    title: `Annual TB Report \u2014 ${year}`,
    headerTitle: 'TUBERCULOSIS ANNUAL REPORT',
    subtitle: `Calendar Year ${year}`,
    footerPeriod: `Annual Report: ${year}`,
    kpis: [
      { label: 'Total Cases', value: summary.totalCases },
      { label: 'Active Cases', value: summary.activeCases },
      { label: 'Success Rate', value: summary.successRate != null ? `${summary.successRate}%` : 'N/A' },
      { label: 'Barangays Covered', value: barangayDistribution?.length || 0 },
    ],
    tables: [
      {
        title: `TREATMENT OUTCOME BREAKDOWN \u2014 ${year}`,
        headers: ['Outcome', 'Count', 'Percentage'],
        rows: outcomes?.map(o => [o.outcome_status, o.count, `${o.percentage}%`]) || [],
      },
    ],
    sideBySide: [
      {
        title: 'SEX DISTRIBUTION',
        headers: ['Sex', 'Count', 'Percentage'],
        rows: demographics?.sex?.map(s => [s.sex, s.count, `${s.percentage}%`]) || [],
      },
    ],
    ageGroups: demographics?.ageGroups,
    caseProfile,
    forecast,
    trend,
    barangayDistribution,
    recommendations,
    cases,
  };
}

function buildBarangayReport(data, barangay, year) {
  const { summary, outcomes, demographics, trend, recommendations, cases, caseProfile, forecast } = data;

  return {
    type: 'barangay',
    title: `Barangay TB Report \u2014 ${barangay} \u00B7 ${year}`,
    headerTitle: 'BARANGAY TB DETAIL REPORT',
    subtitle: `Barangay ${barangay}  \u00B7  ${year}`,
    footerPeriod: `Barangay ${barangay} \u00B7 ${year}`,
    kpis: [
      { label: 'Total Cases', value: summary.totalCases },
      { label: 'Active Cases', value: summary.activeCases },
      { label: 'Success Rate', value: summary.successRate != null ? `${summary.successRate}%` : 'N/A' },
    ],
    tables: [
      {
        title: 'TREATMENT OUTCOME BREAKDOWN',
        headers: ['Outcome', 'Count', 'Percentage'],
        rows: outcomes?.map(o => [o.outcome_status, o.count, `${o.percentage}%`]) || [],
      },
    ],
    sideBySide: [
      {
        title: 'SEX DISTRIBUTION',
        headers: ['Sex', 'Count', 'Percentage'],
        rows: demographics?.sex?.map(s => [s.sex, s.count, `${s.percentage}%`]) || [],
      },
    ],
    ageGroups: demographics?.ageGroups,
    caseProfile,
    forecast,
    trend,
    recommendations,
    cases,
  };
}

/* ─── Report Renderer ────────────────────────────────────────────────── */

function ReportRenderer({ report }) {
  if (!report) return null;

  return (
    <div id="printable-report" style={{ background: '#fff', border: '1px solid #d1d5db', fontFamily: 'serif' }}>

      {/* Header */}
      <div className="px-10 py-6" style={{ borderBottom: '2px solid #0F2D52' }}>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: '#374151' }}>Republic of the Philippines</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: '#111827' }}>Pasig City Health Office</p>
          <div className="mt-3 mb-1" style={{ borderBottom: '1px solid #9CA3AF' }} />
          <h2 className="text-base font-bold uppercase tracking-wide mt-2" style={{ color: '#0F2D52' }}>{report.headerTitle}</h2>
          <p className="text-xs mt-1" style={{ color: '#4B5563' }}>{report.subtitle}</p>
          <div className="mt-1" style={{ borderBottom: '1px solid #9CA3AF' }} />
        </div>
      </div>

      <div className="px-10 py-6 space-y-6">

        {/* Summary */}
        {report.kpis?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>Summary</p>
            <div className="grid gap-x-12" style={{ gridTemplateColumns: `repeat(${report.kpis.length}, 1fr)` }}>
              {report.kpis.map((kpi, i) => (
                <div key={i}>
                  <p className="text-[10px] uppercase" style={{ color: '#6B7280' }}>{kpi.label}</p>
                  <p className="text-lg font-bold" style={{ color: '#111827' }}>{kpi.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tables */}
        {report.tables?.map((table, ti) => (
          <div key={ti}>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>{table.title}</p>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #111827' }}>
                  {table.headers.map((h, hi) => (
                    <th key={hi} className="py-2 text-left font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: ri < table.rows.length - 1 ? '1px solid #E5E7EB' : 'none' }}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="py-2" style={{ color: '#1F2937' }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* Side by Side Sections */}
        {report.sideBySide?.length > 0 && (
          <div className="grid grid-cols-2 gap-8">
            {report.sideBySide.map((section, si) => (
              <div key={si}>
                <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>{section.title}</p>
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #111827' }}>
                      {section.headers.map((h, hi) => (
                        <th key={hi} className="py-2 text-left font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, ri) => (
                      <tr key={ri} style={{ borderBottom: ri < section.rows.length - 1 ? '1px solid #E5E7EB' : 'none' }}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="py-2" style={{ color: '#1F2937' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* Age Distribution Table */}
        {report.ageGroups?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>Age Distribution</p>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #111827' }}>
                  <th className="py-2 text-left font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Age Group</th>
                  <th className="py-2 text-right font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Count</th>
                  <th className="py-2 text-right font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {report.ageGroups.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < report.ageGroups.length - 1 ? '1px solid #E5E7EB' : 'none' }}>
                    <td className="py-2" style={{ color: '#1F2937' }}>{row.age_group}</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{row.count}</td>
                    <td className="py-2 text-right" style={{ color: '#4B5563' }}>{row.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Case Profile */}
        {report.caseProfile && (
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>Registration Group</p>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2" style={{ color: '#4B5563' }}>New Cases</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.newCases}</td>
                  </tr>
                  <tr>
                    <td className="py-2" style={{ color: '#4B5563' }}>Relapse / Recapture</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.relapse}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>Anatomical Site</p>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2" style={{ color: '#4B5563' }}>Pulmonary</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.pulmonary}</td>
                  </tr>
                  <tr>
                    <td className="py-2" style={{ color: '#4B5563' }}>Extra-pulmonary</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.extraPulmonary}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Forecast */}
        {report.forecast?.available && (
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>Forecast</p>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td className="py-2" style={{ color: '#4B5563' }}>Forecasted Cases</td>
                  <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{report.forecast.forecastedCases}</td>
                </tr>
                <tr>
                  <td className="py-2" style={{ color: '#4B5563' }}>Forecast Period</td>
                  <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{report.forecast.period}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* TB Case Trend Table */}
        {report.trend?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>TB Case Trend</p>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #111827' }}>
                  <th className="py-2 text-left font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Month</th>
                  <th className="py-2 text-right font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Cases</th>
                </tr>
              </thead>
              <tbody>
                {report.trend.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < report.trend.length - 1 ? '1px solid #E5E7EB' : 'none' }}>
                    <td className="py-2" style={{ color: '#1F2937' }}>{row.label}</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{row.cases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Barangay Distribution Table */}
        {report.barangayDistribution?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>TB Cases by Barangay</p>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #111827' }}>
                  <th className="py-2 text-left font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Barangay</th>
                  <th className="py-2 text-right font-bold uppercase" style={{ color: '#374151', fontSize: 10 }}>Cases</th>
                </tr>
              </thead>
              <tbody>
                {report.barangayDistribution.map((row, i) => (
                  <tr key={i} style={{ borderBottom: i < report.barangayDistribution.length - 1 ? '1px solid #E5E7EB' : 'none' }}>
                    <td className="py-2" style={{ color: '#1F2937' }}>{row.barangay}</td>
                    <td className="py-2 text-right font-bold" style={{ color: '#111827' }}>{row.cases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recommendations */}
        {report.recommendations?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-2" style={{ color: '#374151', borderBottom: '1px solid #D1D5DB', paddingBottom: 4 }}>Recommendations</p>
            <div className="space-y-1">
              {report.recommendations.map((rec, i) => (
                <p key={i} className="text-xs leading-relaxed" style={{ color: '#374151' }}>{i + 1}. {rec}</p>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-4" style={{ borderTop: '2px solid #0F2D52' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: '#6B7280' }}>TBInsight Dashboard &middot; Pasig City Health Office</span>
            <span className="text-[10px]" style={{ color: '#6B7280' }}>{report.footerPeriod}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-center">
              <div className="w-32" style={{ borderTop: '1px solid #111827' }} />
              <p className="text-[10px] mt-1" style={{ color: '#374151' }}>Prepared by</p>
            </div>
            <div className="text-center">
              <div className="w-32" style={{ borderTop: '1px solid #111827' }} />
              <p className="text-[10px] mt-1" style={{ color: '#374151' }}>Noted by</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────── */

export default function Reports() {
  /* ── Filter state ── */
  const [reportType, setReportType] = useState('monthly');
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1));
  const [filterQuarter, setFilterQuarter] = useState('1');
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filterBarangay, setFilterBarangay] = useState('');

  /* ── Data state ── */
  const [reportData, setReportData] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentReports, setRecentReports] = useState(() => getRecentReports());

  const handleReportTypeChange = useCallback((newType) => {
    setReportType(newType);
    setReport(null);
    setReportData(null);
    setError('');
    setFilterMonth(String(new Date().getMonth() + 1));
    setFilterQuarter('1');
    setFilterBarangay('');
  }, []);

  /* ── Generate report ── */
  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError('');
    setReportData(null);
    setReport(null);
    try {
      const params = { type: reportType, year: filterYear };
      if (reportType === 'monthly') {
        params.month = filterMonth;
      }
      if (reportType === 'quarterly') {
        params.quarter = filterQuarter;
      }
      if (reportType === 'barangay') {
        params.barangay = filterBarangay;
      }
      const res = await API.get('/api/tb/reports/summary', { params });
      setReportData(res.data);
      setRecentReports(saveToRecentReports(res.data));

      // Build structured report
      try {
        let built;
        if (reportType === 'monthly') built = buildMonthlyReport(res.data, filterBarangay, filterMonth, filterYear);
        else if (reportType === 'quarterly') built = buildQuarterlyReport(res.data, filterQuarter, filterYear);
        else if (reportType === 'annual') built = buildAnnualReport(res.data, filterYear);
        else if (reportType === 'barangay') built = buildBarangayReport(res.data, filterBarangay, filterYear);
        setReport(built);
      } catch (buildErr) {
        console.error('Report build error:', buildErr);
        setError('Report was generated but could not be rendered. Please try again.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'The report could not be generated because the TB records could not be retrieved.');
    } finally {
      setLoading(false);
    }
  }, [reportType, filterMonth, filterQuarter, filterYear, filterBarangay]);

  const handleReset = useCallback(() => {
    setReportType('monthly');
    setFilterMonth(String(new Date().getMonth() + 1));
    setFilterQuarter('1');
    setFilterYear(String(new Date().getFullYear()));
    setFilterBarangay('');
    setReportData(null);
    setReport(null);
    setError('');
  }, []);

  const handleDeleteReport = useCallback((id) => {
    if (window.confirm('Delete this report?')) {
      setRecentReports(deleteRecentReport(id));
    }
  }, []);

  /* ────────── Render ────────── */

  return (
    <div className="space-y-6">

      {/* ─── Page Header + Tabs + Filters ─── */}
      <div className="rounded-xl overflow-hidden no-print" style={{ background: '#ffffff', boxShadow: '0 2px 16px rgba(15,45,82,0.07), 0 1px 3px rgba(15,45,82,0.04)' }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5" style={{ borderBottom: '1px solid #DBEAFE' }}>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight" style={{ color: '#0F2D52' }}>Reports</h1>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>Generate and view tuberculosis surveillance reports from TBInsight records.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {reportData?.report?.lastSync && (
              <span className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
                <i className="ri-time-line mr-1" />
                Last Updated: {new Date(reportData.report.lastSync).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #E2E8F0' }}>
          <div className="flex gap-0">
            {REPORT_TYPES.map(rt => (
              <button
                key={rt.key}
                onClick={() => handleReportTypeChange(rt.key)}
                className="relative px-6 py-3 text-left transition-colors"
                style={{ background: 'transparent' }}
              >
                <p className="text-[13px] font-bold" style={{ color: reportType === rt.key ? '#0F2D52' : '#94A3B8' }}>
                  {rt.title}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: reportType === rt.key ? '#64748B' : '#CBD5E1' }}>
                  {rt.desc}
                </p>
                {reportType === rt.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#0F2D52' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3" style={{ background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <div className="flex items-center gap-2 flex-wrap">
            {reportType === 'monthly' && (
              <>
                <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </FilterSelect>
                <FilterSelect label="Month" value={filterMonth} onChange={setFilterMonth}>
                  {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </FilterSelect>
              </>
            )}
            {reportType === 'quarterly' && (
              <>
                <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </FilterSelect>
                <FilterSelect label="Quarter" value={filterQuarter} onChange={setFilterQuarter}>
                  {QUARTER_OPTIONS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                </FilterSelect>
              </>
            )}
            {reportType === 'annual' && (
              <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </FilterSelect>
            )}
            {reportType === 'barangay' && (
              <>
                <FilterSelect label="Year" value={filterYear} onChange={setFilterYear}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </FilterSelect>
                <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay}>
                  <option value="">Select Barangay</option>
                  {BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
                </FilterSelect>
              </>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <button onClick={handleReset}
                className="px-3 py-2 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                Clear
              </button>
              <button onClick={handleGenerate} disabled={loading || (reportType === 'barangay' && !filterBarangay)}
                className="px-4 py-2 text-xs font-semibold"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, opacity: loading || (reportType === 'barangay' && !filterBarangay) ? 0.5 : 1, cursor: loading || (reportType === 'barangay' && !filterBarangay) ? 'not-allowed' : 'pointer', transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                {loading ? 'Generating...' : 'Apply Filters'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Loading State ─── */}
      {loading && (
        <div className="space-y-4">
          <div className="rounded-xl p-6" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
            <div className="flex items-center gap-3 mb-4">
              <i className="ri-loader-4-line animate-spin text-xl" style={{ color: '#0F2D52' }} />
              <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>Generating Report...</p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="rounded-xl p-4" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                  <SkeletonBlock className="h-3 w-20 mb-2" />
                  <SkeletonBlock className="h-7 w-16" />
                </div>
              ))}
            </div>
          </div>
          <SkeletonBlock className="h-64 w-full rounded-xl" />
        </div>
      )}

      {/* ─── Error State ─── */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
           <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#FEF2F2' }}>
            <i className="ri-error-warning-line text-2xl" style={{ color: '#EF4444' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>Unable to Generate Report</p>
            <p className="text-xs mt-1 max-w-md" style={{ color: '#94A3B8' }}>{error}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleGenerate} className="px-3 py-1.5 text-xs font-semibold" style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }} onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
              Try Again
            </button>
            <button onClick={handleReset} className="px-3 py-1.5 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }} onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
              Change Filters
            </button>
          </div>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {!reportData && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            <i className="ri-file-chart-line text-3xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>Select a report type and click Generate</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>Choose a report type above, set your filters, and click Generate & Preview to create a report.</p>
          </div>
        </div>
      )}

      {/* ─── No Records Found ─── */}
      {!loading && !error && reportData && !report && reportData.summary?.totalCases === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F1F5F9' }}>
            <i className="ri-file-search-line text-2xl" style={{ color: '#CBD5E1' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold" style={{ color: '#475569' }}>No TB Records Found</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>No TB records are available for the selected reporting period and geographic coverage.</p>
          </div>
          <button onClick={handleReset} className="px-3 py-1.5 text-xs font-medium" style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }} onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
            Change Filters
          </button>
        </div>
      )}

      {/* ─── Report Preview ─── */}
      {!loading && !error && report && (
        <div className="space-y-5">
          {/* Action Bar */}
          <div className="flex items-center justify-between no-print">
            <div>
              <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>{report.title}</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Generated report preview</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={printReport}
                className="px-3 py-1.5 text-xs font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                Print
              </button>
              <button onClick={() => exportPDF(report)}
                className="px-3 py-1.5 text-xs font-semibold"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>
                Save as PDF
              </button>
            </div>
          </div>

          {/* Rendered Report */}
          <ReportRenderer report={report} />
        </div>
      )}

      {/* ─── Recent Reports ─── */}
      <div className="rounded-xl overflow-hidden no-print" style={{ background: '#ffffff', border: '1px solid #E2E8F0' }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #F1F5F9' }}>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold" style={{ color: '#1E293B' }}>Recent Reports</h3>
          </div>
          <span className="text-[11px] font-bold" style={{ color: '#94A3B8' }}>{recentReports.length} reports</span>
        </div>
        <div className="pb-4">
          {recentReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 px-5">
              <i className="ri-file-list-3-line text-xl" style={{ color: '#CBD5E1' }} />
              <p className="text-xs" style={{ color: '#94A3B8' }}>No reports generated yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#0F2D52' }}>
                    {['Type', 'Period', 'Coverage', 'Generated', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest" style={{ color: '#ffffff' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentReports.slice(0, 10).map((rpt) => (
                    <tr key={rpt.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className="px-4 py-2 text-xs font-semibold" style={{ color: '#1E293B' }}>{rpt.type ? rpt.type.charAt(0).toUpperCase() + rpt.type.slice(1) : 'Report'}</td>
                      <td className="px-4 py-2 text-xs font-medium" style={{ color: '#64748B' }}>{rpt.period || '\u2014'}</td>
                      <td className="px-4 py-2 text-xs font-medium" style={{ color: '#64748B' }}>{rpt.coverage || '\u2014'}</td>
                      <td className="px-4 py-2 text-xs font-medium" style={{ color: '#94A3B8' }}>
                        {rpt.generatedAt ? new Date(rpt.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button aria-label="View report" onClick={() => { setReportType(rpt.type); setFilterYear(String(new Date(rpt.generatedAt).getFullYear())); handleGenerate(); }}
                            className="inline-flex items-center justify-center h-7 w-7 text-sm"
                            style={{ color: '#64748B', borderRadius: 4, transition: 'color 0.15s' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#0F2D52'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; }}>
                            <i className="ri-eye-line" />
                          </button>
                          <button aria-label="Delete report" onClick={() => handleDeleteReport(rpt.id)}
                            className="inline-flex items-center justify-center h-7 w-7 text-sm"
                            style={{ color: '#64748B', borderRadius: 4, transition: 'color 0.15s' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; }}>
                            <i className="ri-delete-bin-line" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
