import { useState, useCallback, useRef, useEffect } from 'react';
import API from '../api/axios';
import {
  exportPDF, exportCSV, exportExcel, printReport,
  saveToRecentReports, getRecentReports, deleteRecentReport,
} from '../utils/exportReports';
import SkeletonBlock from '../../components/SkeletonBlock';
import FilterSelect from '../components/FilterSelect';

/* ─── Constants ──────────────────────────────────────────────────────── */

const monthLabel = month => new Date(2000, Number(month) - 1, 1)
  .toLocaleDateString('en-US', { month: 'long' });
const quarterLabel = quarter => {
  const start = (Number(quarter) - 1) * 3 + 1;
  return `Q${quarter} — ${monthLabel(start)}–${monthLabel(start + 2)}`;
};

const REPORT_TYPES = [
  { key: 'monthly', title: 'Monthly', desc: 'City-wide or per barangay' },
  { key: 'quarterly', title: 'Quarterly', desc: 'Quarter summary and trends' },
  { key: 'annual', title: 'Annual', desc: 'Full-year case analysis' },
  { key: 'barangay', title: 'Barangay', desc: 'Per-barangay detail view' },
];

/* ─── Report Builder ─────────────────────────────────────────────────── */

function buildReport(data, config) {
  const { summary, outcomes, demographics, trend, barangayDistribution, recommendations, cases, caseProfile, forecast, riskSummary, facilityPerformance } = data;
  const { type, barangay, month, quarter, year } = config;
  const isCitywide = !barangay;

  // Period-specific labels
  let title, headerTitle, subtitle, footerPeriod;
  if (type === 'monthly') {
    const monthName = monthLabel(month);
    title = `Monthly TB Report \u2014 ${monthName} ${year}${barangay ? ' \u00B7 ' + barangay : ' \u00B7 City-wide'}`;
    headerTitle = 'TUBERCULOSIS MONTHLY REPORT';
    subtitle = `${monthName} ${year}  \u00B7  ${isCitywide ? 'City-wide' : barangay}`;
    footerPeriod = `Report Period: ${monthName} ${year}`;
  } else if (type === 'quarterly') {
    const qLabel = quarterLabel(quarter);
    title = `Quarterly TB Report \u2014 ${qLabel} ${year}`;
    headerTitle = 'TUBERCULOSIS QUARTERLY REPORT';
    subtitle = `${qLabel} ${year}`;
    footerPeriod = `Report Period: ${qLabel} ${year}`;
  } else if (type === 'annual') {
    title = `Annual TB Report \u2014 ${year}`;
    headerTitle = 'TUBERCULOSIS ANNUAL REPORT';
    subtitle = `Calendar Year ${year}`;
    footerPeriod = `Annual Report: ${year}`;
  } else {
    title = `Barangay TB Report \u2014 ${barangay} \u00B7 ${year}`;
    headerTitle = 'BARANGAY TB DETAIL REPORT';
    subtitle = `Barangay ${barangay}  \u00B7  ${year}`;
    footerPeriod = `Barangay ${barangay} \u00B7 ${year}`;
  }

  // Executive summary
  const executiveSummary = [];
  if (type === 'monthly') {
    const monthName = monthLabel(month);
    executiveSummary.push(`${summary.totalCases} new TB cases were recorded in ${monthName} ${year}${isCitywide ? ' across Pasig City' : ' in ' + barangay}.`);
  } else if (type === 'quarterly') {
    executiveSummary.push(`${summary.totalCases} TB cases were recorded in the ${quarterLabel(quarter)} of ${year}.`);
  } else if (type === 'annual') {
    executiveSummary.push(`${summary.totalCases} TB cases were recorded in calendar year ${year}.`);
  } else {
    executiveSummary.push(`${summary.totalCases} TB cases were recorded in Barangay ${barangay} for ${year}.`);
  }
  if (summary.onTreatmentCases > 0) {
    executiveSummary.push(`${summary.onTreatmentCases} cases are recorded as on treatment.`);
  }
  if (summary.successRate != null) {
    executiveSummary.push(`Treatment success rate is ${summary.successRate}%, ${summary.successRate >= 85 ? 'above' : 'below'} the 85% target.`);
  }
  if (summary.fatalityRate != null) {
    executiveSummary.push(`Case fatality rate is ${summary.fatalityRate}%.`);
  }

  // Bacteriological status breakdown
  const bactMap = {};
  cases?.forEach(c => {
    const s = c.bacteriological_status || 'Unknown';
    bactMap[s] = (bactMap[s] || 0) + 1;
  });
  const bacteriologicalStatus = Object.entries(bactMap)
    .map(([status, count]) => ({
      status,
      count,
      percentage: cases?.length > 0 ? Number(((count / cases.length) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Tables
  const tables = [{
    title: 'CASE STATUS BREAKDOWN',
    headers: ['Status', 'Count'],
    rows: [
      ['DIAGNOSED', summary.diagnosedCases || 0],
      ['ON TREATMENT', summary.onTreatmentCases || 0],
    ],
  }, {
    title: 'TREATMENT OUTCOME BREAKDOWN',
    headers: ['Outcome', 'Count', 'Percentage'],
    rows: outcomes?.map(o => [o.outcome_status, o.count, `${o.percentage}%`]) || [],
  }];

  // Side by side
  const sideBySide = [{
    title: 'SEX DISTRIBUTION',
    headers: ['Sex', 'Count', 'Percentage'],
    rows: demographics?.sex?.map(s => [s.sex, s.count, `${s.percentage}%`]) || [],
  }];

  return {
    type, title, headerTitle, subtitle, footerPeriod,
    executiveSummary, tables, sideBySide,
    ageGroups: demographics?.ageGroups,
    caseProfile, forecast, trend,
    barangayDistribution: isCitywide ? barangayDistribution : null,
    riskSummary: isCitywide ? riskSummary : null,
    bacteriologicalStatus,
    facilityPerformance: facilityPerformance || [],
    recommendations, cases,
  };
}

/* ─── Report Renderer ────────────────────────────────────────────────── */

function ReportRenderer({ report, reportData }) {
  if (!report) return null;

  return (
    <div id="printable-report" style={{ background: '#fff', border: '1px solid #d1d5db', fontFamily: 'Times New Roman, Times, serif', color: '#111827' }}>

      {/* Header */}
      <div className="px-10 py-6" style={{ background: '#0F2D52' }}>
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-[0.15em]" style={{ color: '#93C5FD' }}>Republic of the Philippines</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: '#ffffff' }}>Pasig City Health Office</p>
          <div className="mt-2 mx-auto" style={{ width: 160, borderBottom: '1px solid rgba(255,255,255,0.4)' }} />
          <p className="text-sm font-bold uppercase tracking-wide mt-2" style={{ color: '#ffffff' }}>{report.headerTitle}</p>
          <p className="text-[11px] mt-1" style={{ color: '#BFDBFE' }}>{report.subtitle}</p>
        </div>
      </div>

      <div className="px-10 py-6 space-y-6" style={{ fontSize: '11pt', lineHeight: 1.6 }}>

        {/* Executive Summary */}
        {report.executiveSummary?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Executive Summary</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <div className="space-y-1">
              {report.executiveSummary.map((line, i) => (
                <p key={i} className="text-xs" style={{ color: '#1E293B' }}>{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Summary Stats - simple text row */}
        {reportData?.summary && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Summary</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs" style={{ color: '#1E293B' }}>
              <span><strong>Total Cases:</strong> {reportData.summary.totalCases ?? 0}</span>
              <span><strong>Diagnosed:</strong> {reportData.summary.diagnosedCases ?? 0}</span>
              <span><strong>On Treatment:</strong> {reportData.summary.onTreatmentCases ?? 0}</span>
              <span><strong>Success Rate:</strong> {reportData.summary.successRate != null ? `${reportData.summary.successRate}%` : 'N/A'}</span>
              <span><strong>Case Fatality Rate:</strong> {reportData.summary.fatalityRate != null ? `${reportData.summary.fatalityRate}%` : 'N/A'}</span>
            </div>
          </div>
        )}

        {/* Tables */}
        {report.tables?.map((table, ti) => (
          <div key={ti}>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>{table.title}</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            {table.rows.length > 0 ? (
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
                <thead>
                  <tr style={{ background: '#0F2D52' }}>
                    {table.headers.map((h, hi) => (
                      <th key={hi} className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="py-2 px-3" style={{ color: ci === 0 ? '#1E293B' : '#374151', fontWeight: ci === 0 ? 600 : 400, textAlign: ci > 0 ? 'right' : 'left' }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs italic" style={{ color: '#9CA3AF' }}>No data available for this period.</p>
            )}
          </div>
        ))}

        {/* Side by Side Sections */}
        {report.sideBySide?.length > 0 && (
          <div className="grid grid-cols-2 gap-8">
            {report.sideBySide.map((section, si) => (
              <div key={si}>
                <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>{section.title}</p>
                <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
                {section.rows.length > 0 ? (
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
                    <thead>
                      <tr style={{ background: '#0F2D52' }}>
                        {section.headers.map((h, hi) => (
                          <th key={hi} className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                          {row.map((cell, ci) => (
                            <td key={ci} className="py-2 px-3" style={{ color: ci === 0 ? '#1E293B' : '#374151', fontWeight: ci === 0 ? 600 : 400, textAlign: ci > 0 ? 'right' : 'left' }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs italic" style={{ color: '#9CA3AF' }}>No data available.</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Age Distribution */}
        {report.ageGroups?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Age Distribution</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  <th className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Age Group</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Count</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {report.ageGroups.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>{row.age_group}</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{row.count}</td>
                    <td className="py-2 px-3 text-right" style={{ color: '#374151' }}>{row.percentage}%</td>
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
              <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Registration Group</p>
              <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
                <tbody>
                  <tr style={{ background: '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>New Cases</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.newCases}</td>
                  </tr>
                  <tr style={{ background: '#F8FAFC' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>Relapse / Recapture</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.relapse}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Anatomical Site</p>
              <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
                <tbody>
                  <tr style={{ background: '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>Pulmonary</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.pulmonary}</td>
                  </tr>
                  <tr style={{ background: '#F8FAFC' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>Extra-pulmonary</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{report.caseProfile.extraPulmonary}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bacteriological Status */}
        {report.bacteriologicalStatus?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Bacteriological Status</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  <th className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Status</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Count</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {report.bacteriologicalStatus.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>{row.status}</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{row.count}</td>
                    <td className="py-2 px-3 text-right" style={{ color: '#374151' }}>{row.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Facility Performance */}
        {report.facilityPerformance?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Facility Performance</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  <th className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Facility</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Cases</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.facilityPerformance.map((row, i) => {
                  const rate = row.evaluated > 0 ? ((row.successful / row.evaluated) * 100).toFixed(1) : 'N/A';
                  return (
                    <tr key={i} style={{ background: i % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                      <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>{row.facility}</td>
                      <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{row.total_cases}</td>
                      <td className="py-2 px-3 text-right" style={{ color: '#374151' }}>{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Forecast */}
        {report.forecast?.available && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Forecast</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
              <tbody>
                <tr style={{ background: '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                  <td className="py-2 px-3" style={{ color: '#374151', fontWeight: 600 }}>Forecasted Cases</td>
                  <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{report.forecast.forecastedCases}</td>
                </tr>
                <tr style={{ background: '#F8FAFC' }}>
                  <td className="py-2 px-3" style={{ color: '#374151', fontWeight: 600 }}>Forecast Period</td>
                  <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{report.forecast.period}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* TB Case Trend */}
        {report.trend?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>TB Case Trend</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  <th className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Month</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Cases</th>
                </tr>
              </thead>
              <tbody>
                {report.trend.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>{row.label}</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{row.cases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Barangay Distribution */}
        {report.barangayDistribution?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>TB Cases by Barangay</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #D1D5DB' }}>
              <thead>
                <tr style={{ background: '#0F2D52' }}>
                  <th className="py-2 px-3 text-left font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Barangay</th>
                  <th className="py-2 px-3 text-right font-bold uppercase" style={{ color: '#ffffff', fontSize: 9, borderBottom: '1px solid #0F2D52' }}>Cases</th>
                </tr>
              </thead>
              <tbody>
                {report.barangayDistribution.map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 1 ? '#F8FAFC' : '#ffffff', borderBottom: '1px solid #E5E7EB' }}>
                    <td className="py-2 px-3" style={{ color: '#1E293B', fontWeight: 600 }}>{row.barangay}</td>
                    <td className="py-2 px-3 text-right font-bold" style={{ color: '#111827' }}>{row.cases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Recommendations */}
        {report.recommendations?.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase mb-1" style={{ color: '#0F2D52', letterSpacing: '0.05em' }}>Recommendations</p>
            <div style={{ borderBottom: '1px solid #0F2D52', marginBottom: 6 }} />
            <ol className="text-xs pl-4 space-y-1" style={{ color: '#1E293B', listStyleType: 'decimal' }}>
              {report.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Signature Block */}
        <div className="pt-6" style={{ borderTop: '1px solid #0F2D52' }}>
          <div className="flex justify-between">
            <div className="text-center">
              <div style={{ width: 140, borderBottom: '1px solid #111827' }}>&nbsp;</div>
              <p className="text-[10px] mt-1 font-semibold" style={{ color: '#1E293B' }}>Prepared by</p>
            </div>
            <div className="text-center">
              <div style={{ width: 140, borderBottom: '1px solid #111827' }}>&nbsp;</div>
              <p className="text-[10px] mt-1 font-semibold" style={{ color: '#1E293B' }}>Noted by</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3" style={{ borderTop: '1px solid #D1D5DB' }}>
          <div className="flex items-center justify-between">
            <span className="text-[9px]" style={{ color: '#6B7280' }}>TBInsight &middot; Pasig City Health Office</span>
            <span className="text-[9px]" style={{ color: '#9CA3AF' }}>{report.footerPeriod}</span>
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
  const [filterMonth, setFilterMonth] = useState('');
  const [filterQuarter, setFilterQuarter] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterBarangay, setFilterBarangay] = useState('');

  /* ── Data state ── */
  const [reportData, setReportData] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentReports, setRecentReports] = useState(() => getRecentReports());
  const [barangays, setBarangays] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);
  const [monthsByYear, setMonthsByYear] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [regenerateTrigger, setRegenerateTrigger] = useState(0);
  const [showAllReports, setShowAllReports] = useState(false);
  const [exporting, setExporting] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  const abortRef = useRef(null);
  const reportRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadBarangays = () => API.get('/api/tb/barangays', { signal: controller.signal }).then(res => {
      const names = (res.data.barangays || []).map(b => b.barangay_name || b.name).filter(Boolean).sort();
      setBarangays(names);
    }).catch(() => { });
    loadBarangays();
    window.addEventListener('focus', loadBarangays);
    return () => { controller.abort(); window.removeEventListener('focus', loadBarangays); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadOptions = () => API.get('/api/tb/filter-options', { signal: controller.signal }).then(res => {
      const years = (res.data.years || []).map(String);
      const byYear = res.data.months_by_year || {};
      setAvailableYears(years);
      setMonthsByYear(byYear);
      setFilterYear(current => years.includes(current) ? current : (years[0] || ''));
      const latestMonths = byYear[years[0]] || [];
      setFilterMonth(current => current || String(latestMonths[latestMonths.length - 1] || ''));
      const latestQuarters = [...new Set(latestMonths.map(m => String(Math.ceil(Number(m) / 3))))];
      setFilterQuarter(current => current || (latestQuarters[latestQuarters.length - 1] || ''));
    }).catch(() => {});
    loadOptions();
    window.addEventListener('focus', loadOptions);
    return () => { controller.abort(); window.removeEventListener('focus', loadOptions); };
  }, []);

  const availableMonths = (monthsByYear[filterYear] || []).map(String);
  const availableQuarters = [...new Set(availableMonths.map(m => String(Math.ceil(Number(m) / 3))))];
  const handleYearChange = (year) => {
    setFilterYear(year);
    const months = (monthsByYear[year] || []).map(String);
    setFilterMonth(months.includes(filterMonth) ? filterMonth : (months[months.length - 1] || ''));
    const quarters = [...new Set(months.map(m => String(Math.ceil(Number(m) / 3))))];
    setFilterQuarter(quarters.includes(filterQuarter) ? filterQuarter : (quarters[quarters.length - 1] || ''));
  };

  const handleReportTypeChange = useCallback((newType) => {
    setReportType(newType);
    setReport(null);
    setReportData(null);
    setError('');
    setFilterMonth((monthsByYear[filterYear] || []).map(String).at(-1) || '');
    setFilterQuarter([...new Set((monthsByYear[filterYear] || []).map(m => String(Math.ceil(Number(m) / 3))))].at(-1) || '');
    setFilterBarangay('');
  }, [monthsByYear, filterYear]);

  /* ── Generate report ── */
  const handleGenerate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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
      const res = await API.get('/api/tb/reports/summary', { params, signal: controller.signal });
      setReportData(res.data);
      setRecentReports(saveToRecentReports(res.data, { reportType, year: filterYear, month: filterMonth, quarter: filterQuarter, barangay: filterBarangay }));

      // Build structured report
      try {
        const built = buildReport(res.data, {
          type: reportType, barangay: filterBarangay,
          month: filterMonth, quarter: filterQuarter, year: filterYear,
        });
        setReport(built);
      } catch {
        setError('Report was generated but could not be rendered. Please try again.');
      }
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError(err.response?.data?.error || 'The report could not be generated because the TB records could not be retrieved.');
    } finally {
      setLoading(false);
    }
  }, [reportType, filterMonth, filterQuarter, filterYear, filterBarangay]);

  useEffect(() => {
    if (regenerateTrigger > 0) handleGenerate();
  }, [regenerateTrigger, handleGenerate]);

  const handleReset = useCallback(() => {
    setReportType('monthly');
    const latestYear = availableYears[0] || '';
    const months = monthsByYear[latestYear] || [];
    setFilterMonth(String(months[months.length - 1] || ''));
    setFilterQuarter(String(months.length ? Math.ceil(Number(months[months.length - 1]) / 3) : ''));
    setFilterYear(latestYear);
    setFilterBarangay('');
    setReportData(null);
    setReport(null);
    setError('');
  }, [availableYears, monthsByYear]);

  const handleDeleteReport = useCallback(() => {
    if (!deleteTarget) return;
    setRecentReports(deleteRecentReport(deleteTarget.id));
    setDeleteTarget(null);
  }, [deleteTarget]);

  const handleExport = useCallback(async (key, fn) => {
    try {
      setExporting(key);
      await fn();
    } catch {
      // silent
    } finally {
      setExporting('');
    }
  }, []);

  useEffect(() => {
    if (report && reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [report]);

  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (e) => { if (e.key === 'Escape') setDeleteTarget(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget]);

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
          <div className="flex gap-0" role="tablist" aria-label="Report type">
            {REPORT_TYPES.map(rt => (
              <button
                key={rt.key}
                role="tab"
                aria-selected={reportType === rt.key}
                aria-controls={`tabpanel-${rt.key}`}
                id={`tab-${rt.key}`}
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
                <FilterSelect label="Year" value={filterYear} onChange={handleYearChange}>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </FilterSelect>
                <FilterSelect label="Month" value={filterMonth} onChange={setFilterMonth}>
                  {availableMonths.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}
                </FilterSelect>
              </>
            )}
            {reportType === 'quarterly' && (
              <>
                <FilterSelect label="Year" value={filterYear} onChange={handleYearChange}>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </FilterSelect>
                <FilterSelect label="Quarter" value={filterQuarter} onChange={setFilterQuarter}>
                  {availableQuarters.map(quarter => <option key={quarter} value={quarter}>{quarterLabel(quarter)}</option>)}
                </FilterSelect>
              </>
            )}
            {reportType === 'annual' && (
              <FilterSelect label="Year" value={filterYear} onChange={handleYearChange}>
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </FilterSelect>
            )}
            {reportType === 'barangay' && (
              <>
                <FilterSelect label="Year" value={filterYear} onChange={handleYearChange}>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </FilterSelect>
                <FilterSelect label="Barangay" value={filterBarangay} onChange={setFilterBarangay} selectStyle={{ maxWidth: 160 }}>
                  <option value="">Select Barangay</option>
                  {barangays.map(b => <option key={b} value={b}>{b}</option>)}
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
              <button onClick={handleGenerate} disabled={loading || !filterYear || (reportType === 'monthly' && !filterMonth) || (reportType === 'quarterly' && !filterQuarter) || (reportType === 'barangay' && !filterBarangay)}
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
            <div className="flex items-center gap-3 mb-3">
              <i className="ri-loader-4-line animate-spin text-xl" style={{ color: '#0F2D52' }} />
              <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>Generating Report...</p>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden mb-4" style={{ background: '#E2E8F0' }}>
              <div className="h-full rounded-full" style={{
                background: 'linear-gradient(90deg, #0F2D52, #3B82F6)',
                animation: 'reports-progress 2s ease-in-out infinite',
                width: '60%',
              }} />
            </div>
            <style>{`@keyframes reports-progress { 0% { width: 10%; } 50% { width: 70%; } 100% { width: 90%; } }`}</style>
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
            <p className="text-sm font-bold" style={{ color: '#475569' }}>Select a report type and click Apply Filters</p>
            <p className="text-xs mt-1 max-w-sm" style={{ color: '#94A3B8' }}>Choose a report type above, set your filters, and click Apply Filters to create a report.</p>
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
        <div ref={reportRef} className="space-y-5 reports-print-root">
          {/* Action Bar */}
          <div className="flex items-center justify-between no-print">
            <div>
              <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>{report.title}</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Generated report preview</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setExportFormat('pdf'); setShowExportModal(true); }}
                className="px-4 py-2 text-xs font-semibold flex items-center gap-1.5"
                style={{ background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4, transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#174A7E'; e.currentTarget.style.borderColor = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; e.currentTarget.style.borderColor = '#0F2D52'; }}>

                Export
              </button>
            </div>
          </div>

          {/* Rendered Report */}
          <ReportRenderer report={report} reportData={reportData} />
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
                  {recentReports.slice(0, showAllReports ? recentReports.length : 10).map((rpt) => (
                    <tr key={rpt.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td className="px-4 py-2 text-xs font-semibold" style={{ color: '#1E293B' }}>{rpt.type ? rpt.type.charAt(0).toUpperCase() + rpt.type.slice(1) : 'Report'}</td>
                      <td className="px-4 py-2 text-xs font-medium" style={{ color: '#64748B' }}>{rpt.period || '\u2014'}</td>
                      <td className="px-4 py-2 text-xs font-medium" style={{ color: '#64748B' }}>{rpt.coverage || '\u2014'}</td>
                      <td className="px-4 py-2 text-xs font-medium" style={{ color: '#94A3B8' }}>
                        {rpt.generatedAt ? new Date(rpt.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <button aria-label="View report" onClick={() => {
                            const f = rpt.filters || {};
                            setReportType(f.reportType || rpt.type || 'monthly');
                            setFilterYear(f.year || String(new Date(rpt.generatedAt).getFullYear()));
                            setFilterMonth(f.month || String(new Date().getMonth() + 1));
                            setFilterQuarter(f.quarter || '1');
                            setFilterBarangay(f.barangay || '');
                            setRegenerateTrigger(n => n + 1);
                          }}
                            className="inline-flex items-center justify-center h-7 w-7 text-sm"
                            style={{ color: '#64748B', borderRadius: 4, transition: 'color 0.15s' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#0F2D52'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#64748B'; }}>
                            <i className="ri-eye-line" />
                          </button>
                          <button aria-label="Delete report" onClick={() => setDeleteTarget(rpt)}
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
          {recentReports.length > 10 && (
            <div className="flex justify-center pt-3 px-5">
              <button onClick={() => setShowAllReports(!showAllReports)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg"
                style={{ color: '#0F2D52', background: '#F1F5F9', border: '1px solid #E2E8F0', transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E2E8F0'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F1F5F9'; }}>
                {showAllReports ? 'Show Less' : `Show All (${recentReports.length})`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Delete Confirmation Modal ─── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div className="absolute inset-0" style={{ background: 'rgba(15,45,82,0.2)' }} onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm mx-4 rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 20px 60px rgba(15,45,82,0.25)' }}>
            <div className="px-6 py-5 text-center">
              <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#FEF2F2' }}>
                <i className="ri-error-warning-line text-xl" style={{ color: '#EF4444' }} />
              </div>
              <p className="text-sm font-bold" style={{ color: '#1E293B' }}>Delete Report?</p>
              <p className="text-xs mt-1.5 max-w-xs mx-auto" style={{ color: '#64748B' }}>
                This will permanently delete the {deleteTarget.type ? deleteTarget.type.charAt(0).toUpperCase() + deleteTarget.type.slice(1) : 'report'} report for {deleteTarget.period || 'this period'}. This action cannot be undone.
              </p>
            </div>
            <div className="flex" style={{ borderTop: '1px solid #F1F5F9' }}>
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-3 text-xs font-semibold"
                style={{ color: '#374151', background: '#ffffff', borderRight: '1px solid #F1F5F9', transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}>
                Cancel
              </button>
              <button onClick={handleDeleteReport}
                className="flex-1 px-4 py-3 text-xs font-semibold"
                style={{ color: '#ffffff', background: '#DC2626', transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#B91C1C'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#DC2626'; }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Export Modal ─── */}
      {showExportModal && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Export report">
          <div className="absolute inset-0" style={{ background: 'rgba(15,45,82,0.2)' }} onClick={() => { setShowExportModal(false); setExporting(''); }} />
          <div className="relative w-full max-w-md mx-4 rounded-xl overflow-hidden" style={{ background: '#ffffff', boxShadow: '0 20px 60px rgba(15,45,82,0.25)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #E2E8F0' }}>
              <div>
                <p className="text-sm font-bold" style={{ color: '#0F2D52' }}>Export Reports</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>Choose a format to download</p>
              </div>
              <button onClick={() => { setShowExportModal(false); setExporting(''); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: '#F3F4F6', color: '#64748B', transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#E5E7EB'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F3F4F6'; }}>
                <i className="ri-close-line text-base" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Format Selection */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: '#64748B' }}>Export Format</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'pdf', icon: 'ri-file-pdf-line', label: 'PDF', color: '#DC2626' },
                    { key: 'excel', icon: 'ri-file-excel-line', label: 'Excel', color: '#16A34A' },
                    { key: 'print', icon: 'ri-printer-line', label: 'Print', color: '#2563EB' },
                  ].map(fmt => (
                    <button
                      key={fmt.key}
                      onClick={() => setExportFormat(fmt.key)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all"
                      style={{
                        background: exportFormat === fmt.key ? 'rgba(15,45,82,0.06)' : '#F8FAFC',
                        border: exportFormat === fmt.key ? '2px solid #0F2D52' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <i className={`${fmt.icon} text-xl`} style={{ color: exportFormat === fmt.key ? fmt.color : '#94A3B8' }} />
                      <span className="text-[11px] font-bold" style={{ color: exportFormat === fmt.key ? '#0F2D52' : '#64748B' }}>{fmt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Info */}
              <div className="flex items-start gap-2.5 p-3 rounded-lg" style={{ background: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                <i className="ri-information-line text-sm mt-0.5 shrink-0" style={{ color: '#0284C7' }} />
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: '#0F2D52' }}>
                    Ready to export as {exportFormat === 'pdf' ? 'PDF' : exportFormat === 'excel' ? 'Excel' : 'Print'} document
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#64748B' }}>
                    {report?.title || 'TB Report'} — {report?.subtitle || ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3.5" style={{ borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
              <button onClick={() => { setShowExportModal(false); setExporting(''); }}
                className="px-4 py-2 text-xs font-medium rounded-lg"
                style={{ background: '#ffffff', color: '#374151', border: '1px solid #D1D5DB', transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  const formatMap = {
                    pdf: { fn: () => exportPDF(report), label: 'PDF' },
                    excel: { fn: () => exportExcel(reportData), label: 'Excel' },
                    print: { fn: () => printReport(), label: 'Print' },
                  };
                  const selected = formatMap[exportFormat];
                  if (!selected) return;
                  setShowExportModal(false);
                   await handleExport(exportFormat, selected.fn);
                }}
                disabled={!!exporting}
                className="px-5 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5"
                style={{ background: '#0F2D52', color: '#ffffff', opacity: exporting ? 0.5 : 1, cursor: exporting ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => { if (!exporting) e.currentTarget.style.background = '#174A7E'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0F2D52'; }}>
                {exporting ? <><i className="ri-loader-4-line animate-spin" /> Exporting...</> : <>Download</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
