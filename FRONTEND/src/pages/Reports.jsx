import { useState } from 'react';
import { BARANGAYS } from './Analytics';
import { useTBData } from '../context/TBDataContext';

/* ─── Helper: compute metrics from a set of records ─── */
function computeMetricsFromRecords(recs) {
  const cases = recs.length;
  const active = recs.filter(r => r.status === 'Active' || r.status === 'Treatment').length;
  const cured = recs.filter(r => r.status === 'Cured').length;
  const completed = recs.filter(r => r.status === 'Completed').length;
  const success = cases > 0 ? Math.round(((cured + completed) / cases) * 100) : 0;
  const outcomes = {};
  recs.forEach(r => { outcomes[r.status] = (outcomes[r.status] || 0) + 1; });
  const gender = { Male: 0, Female: 0 };
  recs.forEach(r => { gender[r.sex] = (gender[r.sex] || 0) + 1; });
  return { cases, active, success, outcomes, gender };
}

function getBrgyForecast(brgyName, forecastData) {
  const item = forecastData.find(f => f.barangay === brgyName);
  return item?.predictedCases || 0;
}

function getBrgyRisk(brgyName, forecastData) {
  const item = forecastData.find(f => f.barangay === brgyName);
  return item?.risk || 'Low';
}

function getOutcomeRemarks(name) {
  if (name === 'Cured' || name === 'Completed') return '✓ Treatment successful';
  if (name === 'Died') return 'Mortality case';
  if (name === 'Failed') return 'Requires retreatment review';
  if (name === 'Defaulted') return 'Contact tracing needed';
  if (name === 'Active' || name === 'Treatment') return 'Currently under treatment';
  return 'Pending evaluation';
}

/* ─── Report Types (matches HTML prototype) ─── */
const REPORT_TYPES = [
  { id: 'monthly', icon: 'ri-calendar-event-line', title: 'Monthly Report', desc: 'City-wide or per Barangay', sub: 'Select month & barangay', color: '#2E6FAF' },
  { id: 'quarterly', icon: 'ri-calendar-todo-line', title: 'Quarterly Report', desc: 'Quarter summary & trends', sub: 'Q1 / Q2 / Q3 / Q4', color: '#1a5276' },
  { id: 'annual', icon: 'ri-calendar-line', title: 'Annual Report', desc: 'Full-year case analysis', sub: 'Year 2023 – 2025', color: '#7b2d00' },
  { id: 'barangay', icon: 'ri-map-pin-line', title: 'Barangay Report', desc: 'Per-barangay detail view', sub: 'All 30 Barangays', color: '#4a235a' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const QUARTERS = [
  { value: 'Q1', label: 'Q1 (Jan–Mar)' },
  { value: 'Q2', label: 'Q2 (Apr–Jun)' },
  { value: 'Q3', label: 'Q3 (Jul–Sep)' },
  { value: 'Q4', label: 'Q4 (Oct–Dec)' },
];

const QUARTER_MONTHS = {
  Q1: ['01', '02', '03'], Q2: ['04', '05', '06'],
  Q3: ['07', '08', '09'], Q4: ['10', '11', '12'],
};

const QUARTER_MONTH_NAMES = {
  Q1: ['January', 'February', 'March'],
  Q2: ['April', 'May', 'June'],
  Q3: ['July', 'August', 'September'],
  Q4: ['October', 'November', 'December'],
};

const MONTH_NUM_MAP = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

const QUARTER_FULL_LABELS = {
  Q1: 'Q1 (Jan–Mar)', Q2: 'Q2 (Apr–Jun)',
  Q3: 'Q3 (Jul–Sep)', Q4: 'Q4 (Oct–Dec)',
};

/* ─── Shared inline styles matching HTML prototype ─── */
const S = {
  sectionTitle: { fontWeight: 700, fontSize: '.88rem', marginBottom: 8, color: '#1a202c' },
  th: { padding: '8px 12px', textAlign: 'left', fontWeight: 700 },
  thCenter: { padding: '8px 12px', textAlign: 'center', fontWeight: 700 },
  td: (center) => ({ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', textAlign: center ? 'center' : 'left' }),
  tdBold: (center) => ({ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', textAlign: center ? 'center' : 'left', fontWeight: 700 }),
  rowBg: (i) => i % 2 ? '#f8fafc' : '#fff',
  totalRow: { background: '#e8f5f0', fontWeight: 700 },
};

/* ─── Risk Badge (shared) ─── */
function RiskBadge({ risk }) {
  const bg = risk === 'High' ? '#fee2e2' : risk === 'Moderate' ? '#fef3c7' : '#d4edda';
  const fg = risk === 'High' ? '#991b1b' : risk === 'Moderate' ? '#92400e' : '#155724';
  return (
    <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 700 }}>
      {risk}
    </span>
  );
}

/* ─── Monthly Report Builder ─── */
function buildMonthlyReport(brgy, month, year, records, forecastData, analytics) {
  const isCitywide = !brgy;
  const monthNum = MONTH_NUM_MAP[month];
  const filterPrefix = `${year}-${monthNum}`;

  let filtered = records.filter(r => r.diagnosisDate.startsWith(filterPrefix));
  if (brgy) filtered = filtered.filter(r => r.barangay === brgy);

  const m = computeMetricsFromRecords(filtered);
  const forecast = brgy
    ? getBrgyForecast(brgy, forecastData)
    : analytics.forecastNextMonth;
  const risk = brgy ? getBrgyRisk(brgy, forecastData) : null;

  const maleCount = m.gender.Male;
  const femaleCount = m.gender.Female;
  const malePct = m.cases > 0 ? Math.round((maleCount / m.cases) * 100) : 0;
  const femalePct = m.cases > 0 ? Math.round((femaleCount / m.cases) * 100) : 0;

  const outcomes = Object.keys(m.outcomes).sort().map(name => {
    const count = m.outcomes[name];
    return { name, count, pct: m.cases > 0 ? Math.round((count / m.cases) * 100) : 0 };
  });

  const pulmonaryCount = filtered.filter(r => r.anatomicalSite === 'Pulmonary').length;
  const extraPulmonaryCount = filtered.filter(r => r.anatomicalSite === 'Extra-pulmonary').length;

  const highRiskBrgys = forecastData.filter(f => f.risk === 'High').map(f => f.barangay);

  return {
    title: `Monthly TB Report — ${month} ${year}${brgy ? ' · ' + brgy : ' · City-wide'}`,
    headerColor: '#0d6659',
    headerTitle: 'TUBERCULOSIS MONTHLY REPORT',
    subtitle: `${month} ${year}  ·  ${isCitywide ? 'City-wide' : brgy}`,
    footerPeriod: `Report Period: ${month} ${year}`,
    kpis: [
      { label: 'Total Cases', value: m.cases, color: '#0d6659' },
      { label: 'Active Cases', value: m.active, color: '#f39c12' },
      { label: 'Success Rate', value: `${m.success}%`, color: '#27ae60' },
      { label: 'Next Mo. Forecast', value: forecast, color: '#7c3aed' },
    ],
    riskBanner: brgy ? { label: 'Barangay', value: brgy, risk, rank: risk === 'High' ? 'High Priority (Urgent)' : 'Standard Monitoring' } : null,
    riskBannerStyle: { background: '#d0f0eb', border: '1px solid #11a88e' },
    tables: [
      {
        title: 'TREATMENT OUTCOME BREAKDOWN',
        headers: [
          { label: 'Outcome', align: 'left' },
          { label: 'Count', align: 'center' },
          { label: 'Percentage', align: 'center' },
          { label: 'Remarks', align: 'left' },
        ],
        rows: outcomes.map(o => [
          { value: o.name },
          { value: o.count, center: true, bold: true },
          { value: `${o.pct}%`, center: true },
          { value: getOutcomeRemarks(o.name), muted: true },
        ]),
        totalRow: { label: 'TOTAL', values: [{ value: m.cases, center: true }, { value: '100%', center: true }] },
        accentColor: '#0d6659',
      },
    ],
    sideBySide: [
      {
        title: 'SEX DISTRIBUTION',
        headers: [
          { label: 'Sex', align: 'left' },
          { label: 'Count', align: 'center' },
          { label: '%', align: 'center' },
        ],
        rows: [
          [{ value: 'Male' }, { value: maleCount, center: true }, { value: `${malePct}%`, center: true }],
          [{ value: 'Female' }, { value: femaleCount, center: true }, { value: `${femalePct}%`, center: true }],
        ],
        accentColor: '#0d6659',
      },
      {
        title: 'KEY INDICATORS',
        type: 'keyValue',
        rows: [
          ['WHO Success Rate Target', '≥ 85%'],
          ['Achieved Success Rate', `${m.success}% ${m.success >= 85 ? '✓' : '⚠'}`],
          ['Anatomical Site — Pulmonary', `${pulmonaryCount} cases`],
          ['Anatomical Site — Extra-Pulmonary', `${extraPulmonaryCount} cases`],
        ],
        successRate: m.success,
      },
    ],
    recommendations: `${m.success < 85 ? `Treatment success rate of ${m.success}% is below the WHO target of 85%. Strengthen treatment adherence monitoring and follow-up. ` : ''}${isCitywide ? `Focus resources on high-risk barangays: ${highRiskBrgys.join(', ') || 'None identified'}.` : `Maintain surveillance for ${brgy}. ${risk === 'High' ? 'Deploy additional contact tracing. Increase active case finding.' : risk === 'Moderate' ? 'Continue regular screening and treatment monitoring.' : 'Maintain standard surveillance protocols.'}`}`,
  };
}

/* ─── Quarterly Report Builder ─── */
function buildQuarterlyReport(quarter, year, records, forecastData) {
  const qMonths = QUARTER_MONTHS[quarter];
  const filtered = records.filter(r => {
    const yr = r.diagnosisDate.slice(0, 4);
    const mo = r.diagnosisDate.slice(5, 7);
    return yr === year && qMonths.includes(mo);
  });

  const m = computeMetricsFromRecords(filtered);
  const newCases = filtered.filter(r => r.registrationGroup === 'New').length;
  const highRisk = forecastData.filter(f => f.risk === 'High').length;

  const monthlyRows = qMonths.map((mo, i) => {
    const monthRecs = filtered.filter(r => r.diagnosisDate.slice(5, 7) === mo);
    const mm = computeMetricsFromRecords(monthRecs);
    return [
      { value: `${QUARTER_MONTH_NAMES[quarter][i]} ${year}` },
      { value: mm.cases, center: true },
      { value: mm.active, center: true },
      { value: mm.outcomes['Cured'] || 0, center: true },
      { value: mm.outcomes['Completed'] || 0, center: true },
      { value: `${mm.success}%`, center: true, bold: true, color: mm.success >= 85 ? '#27ae60' : '#e74c3c' },
    ];
  });

  const barangayMap = {};
  filtered.forEach(r => { barangayMap[r.barangay] = (barangayMap[r.barangay] || 0) + 1; });
  const top5 = Object.entries(barangayMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    title: `Quarterly TB Report — ${quarter} ${year}`,
    headerColor: '#1a5276',
    headerTitle: 'TUBERCULOSIS QUARTERLY REPORT',
    subtitle: `${quarter} ${year}  ·  ${QUARTER_MONTH_NAMES[quarter][0]}–${QUARTER_MONTH_NAMES[quarter][2]}`,
    footerPeriod: `Report Period: ${quarter} ${year}`,
    kpis: [
      { label: 'Total Cases', value: m.cases, color: '#1a5276' },
      { label: 'New Cases', value: newCases, color: '#2e86c1' },
      { label: 'Success Rate', value: `${m.success}%`, color: '#27ae60' },
      { label: 'High Risk Brgy', value: highRisk, color: '#e74c3c' },
    ],
    tables: [
      {
        title: `MONTHLY BREAKDOWN — ${quarter} ${year}`,
        headers: [
          { label: 'Month', align: 'left' },
          { label: 'New Cases', align: 'center' },
          { label: 'Active', align: 'center' },
          { label: 'Cured', align: 'center' },
          { label: 'Completed', align: 'center' },
          { label: 'Success Rate', align: 'center' },
        ],
        rows: monthlyRows,
        accentColor: '#1a5276',
      },
      {
        title: `TOP 5 BARANGAYS BY CASE COUNT — ${quarter} ${year}`,
        headers: [
          { label: 'Rank', align: 'left' },
          { label: 'Barangay', align: 'left' },
          { label: 'Cases', align: 'center' },
          { label: 'Active', align: 'center' },
          { label: 'Risk', align: 'center' },
        ],
        rows: top5.map(([b, count], i) => {
          const bRecs = filtered.filter(r => r.barangay === b);
          const bActive = bRecs.filter(r => r.status === 'Active' || r.status === 'Treatment').length;
          return [
            { value: `#${i + 1}`, bold: true },
            { value: b, bold: true },
            { value: count, center: true },
            { value: bActive, center: true },
            { value: getBrgyRisk(b, forecastData), risk: true },
          ];
        }),
        accentColor: '#1a5276',
      },
    ],
    recommendations: `${quarter} ${year} recorded ${m.cases} total TB cases in Pasig City. Overall treatment success rate is ${m.success}%${m.success < 85 ? ' — below the WHO target of 85%; action plans recommended' : ' — meeting the WHO target of ≥85%'}. High-priority barangays require continued resource deployment.`,
  };
}

/* ─── Annual Report Builder ─── */
function buildAnnualReport(year, records, forecastData) {
  const filtered = records.filter(r => r.diagnosisDate.startsWith(year));

  const m = computeMetricsFromRecords(filtered);

  // Previous year for YoY comparison
  const prevYear = String(Number(year) - 1);
  const prevFiltered = records.filter(r => r.diagnosisDate.startsWith(prevYear));
  const prevTotal = prevFiltered.length;
  const yoyGrowth = prevTotal > 0
    ? `+${Math.round(((m.cases - prevTotal) / prevTotal) * 100)}%`
    : 'N/A';

  const quarterlyRows = ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => {
    const qMo = QUARTER_MONTHS[q];
    const qRecs = filtered.filter(r => {
      const mo = r.diagnosisDate.slice(5, 7);
      return qMo.includes(mo);
    });
    const qm = computeMetricsFromRecords(qRecs);
    const qCured = qm.outcomes['Cured'] || 0;
    const qCompleted = qm.outcomes['Completed'] || 0;
    const qDied = qm.outcomes['Died'] || 0;
    const qDefaulted = qm.outcomes['Defaulted'] || 0;
    return [
      { value: QUARTER_FULL_LABELS[q], bold: true },
      { value: qm.cases, center: true },
      { value: qCured, center: true },
      { value: qCompleted, center: true },
      { value: qDied, center: true },
      { value: qDefaulted, center: true },
      { value: `${qm.success}%`, center: true, bold: true, color: qm.success >= 85 ? '#27ae60' : '#e74c3c' },
    ];
  });

  // All barangays summary
  const barangayMap = {};
  filtered.forEach(r => { barangayMap[r.barangay] = (barangayMap[r.barangay] || 0) + 1; });

  const allBrgyRows = Object.entries(barangayMap)
    .sort((a, b) => b[1] - a[1])
    .map(([b, count]) => {
      const bRecs = filtered.filter(r => r.barangay === b);
      const bActive = bRecs.filter(r => r.status === 'Active' || r.status === 'Treatment').length;
      const bCured = bRecs.filter(r => r.status === 'Cured').length;
      const bCompleted = bRecs.filter(r => r.status === 'Completed').length;
      const bSuccess = count > 0 ? Math.round(((bCured + bCompleted) / count) * 100) : 0;
      return [
        { value: b, bold: true },
        { value: count, center: true },
        { value: bActive, center: true },
        { value: `${bSuccess}%`, center: true, bold: true, color: bSuccess >= 85 ? '#27ae60' : '#e74c3c' },
        { value: getBrgyRisk(b, forecastData), risk: true },
      ];
    });

  return {
    title: `Annual TB Report — ${year}`,
    headerColor: '#7b2d00',
    headerTitle: 'TUBERCULOSIS ANNUAL REPORT',
    subtitle: `Calendar Year ${year}`,
    footerPeriod: `Annual Report: ${year}`,
    kpis: [
      { label: 'Total Cases', value: m.cases, color: '#7b2d00' },
      { label: 'Success Rate', value: `${m.success}%`, color: '#27ae60' },
      { label: 'Barangays Covered', value: Object.keys(barangayMap).length, color: '#1a5276' },
      { label: 'YoY Growth', value: yoyGrowth, color: '#f39c12' },
    ],
    tables: [
      {
        title: `QUARTERLY BREAKDOWN — ${year}`,
        headers: [
          { label: 'Quarter', align: 'left' },
          { label: 'Cases', align: 'center' },
          { label: 'Cured', align: 'center' },
          { label: 'Completed', align: 'center' },
          { label: 'Died', align: 'center' },
          { label: 'Lost to F-U', align: 'center' },
          { label: 'Success Rate', align: 'center' },
        ],
        rows: quarterlyRows,
        accentColor: '#7b2d00',
      },
    ],
    allBarangaysTable: {
      title: `ALL BARANGAYS SUMMARY — ${year}`,
      headers: [
        { label: 'Barangay', align: 'left' },
        { label: 'Cases', align: 'center' },
        { label: 'Active', align: 'center' },
        { label: 'Success Rate', align: 'center' },
        { label: 'Risk', align: 'center' },
      ],
      rows: allBrgyRows,
      accentColor: '#7b2d00',
      compact: true,
    },
  };
}

/* ─── Barangay Report Builder ─── */
function buildBarangayReport(brgy, year, records, forecastData) {
  if (!brgy) {
    const filtered = records.filter(r => r.diagnosisDate.startsWith(year));
    const barangayMap = {};
    filtered.forEach(r => { barangayMap[r.barangay] = (barangayMap[r.barangay] || 0) + 1; });

    const sorted = Object.entries(barangayMap).sort((a, b) => b[1] - a[1]);

    return {
      title: `Barangay Summary Report — All Barangays · ${year}`,
      headerColor: '#4a235a',
      headerTitle: 'BARANGAY TB STATUS REPORT',
      subtitle: `All 30 Barangays  ·  ${year}`,
      footerPeriod: `Barangay Summary · ${year}`,
      showKpiRow: false,
      tables: [
        {
          title: null,
          headers: [
            { label: 'Barangay', align: 'left' },
            { label: 'Total Cases', align: 'center' },
            { label: 'Active', align: 'center' },
            { label: 'Success Rate', align: 'center' },
            { label: 'Forecast', align: 'center' },
            { label: 'Risk Level', align: 'center' },
          ],
          rows: sorted.map(([b, count]) => {
            const bRecs = filtered.filter(r => r.barangay === b);
            const bActive = bRecs.filter(r => r.status === 'Active' || r.status === 'Treatment').length;
            const bCured = bRecs.filter(r => r.status === 'Cured').length;
            const bCompleted = bRecs.filter(r => r.status === 'Completed').length;
            const bSuccess = count > 0 ? Math.round(((bCured + bCompleted) / count) * 100) : 0;
            const bForecast = getBrgyForecast(b, forecastData);
            return [
              { value: b, bold: true },
              { value: count, center: true },
              { value: bActive, center: true },
              { value: `${bSuccess}%`, center: true, bold: true, color: bSuccess >= 85 ? '#27ae60' : '#e74c3c' },
              { value: bForecast, center: true },
              { value: getBrgyRisk(b, forecastData), risk: true },
            ];
          }),
          accentColor: '#4a235a',
        },
      ],
    };
  }

  // Detail report for a specific barangay
  const filtered = records.filter(r => r.barangay === brgy && r.diagnosisDate.startsWith(year));
  const m = computeMetricsFromRecords(filtered);
  const forecast = getBrgyForecast(brgy, forecastData);
  const risk = getBrgyRisk(brgy, forecastData);

  const outcomes = Object.keys(m.outcomes).sort().map(name => {
    const count = m.outcomes[name];
    return { name, count, pct: m.cases > 0 ? Math.round((count / m.cases) * 100) : 0 };
  });

  const maleCount = m.gender.Male;
  const femaleCount = m.gender.Female;
  const malePct = m.cases > 0 ? Math.round((maleCount / m.cases) * 100) : 0;
  const femalePct = m.cases > 0 ? Math.round((femaleCount / m.cases) * 100) : 0;

  const pulmonaryCount = filtered.filter(r => r.anatomicalSite === 'Pulmonary').length;
  const extraPulmonaryCount = filtered.filter(r => r.anatomicalSite === 'Extra-pulmonary').length;

  return {
    title: `Barangay TB Report — ${brgy} · ${year}`,
    headerColor: '#4a235a',
    headerTitle: 'BARANGAY TB DETAIL REPORT',
    subtitle: `Barangay ${brgy}  ·  ${year}`,
    footerPeriod: `Barangay ${brgy} · ${year}`,
    infoBanner: { brgy, risk, cases: m.cases, active: m.active, success: m.success },
    kpis: [
      { label: 'Total Cases', value: m.cases, color: '#4a235a' },
      { label: 'Active Cases', value: m.active, color: '#f39c12' },
      { label: 'Success Rate', value: `${m.success}%`, color: '#27ae60' },
      { label: 'Forecast', value: forecast, color: '#7c3aed' },
    ],
    tables: [
      {
        title: 'TREATMENT OUTCOME BREAKDOWN',
        headers: [
          { label: 'Outcome', align: 'left' },
          { label: 'Count', align: 'center' },
          { label: '%', align: 'center' },
        ],
        rows: outcomes.map(o => [
          { value: o.name },
          { value: o.count, center: true, bold: true },
          { value: `${o.pct}%`, center: true },
        ]),
        totalRow: { label: 'TOTAL', values: [{ value: m.cases, center: true }, { value: '100%', center: true }] },
        accentColor: '#4a235a',
      },
    ],
    sideBySide: [
      {
        title: 'SEX DISTRIBUTION',
        headers: [
          { label: 'Sex', align: 'left' },
          { label: 'Count', align: 'center' },
          { label: '%', align: 'center' },
        ],
        rows: [
          [{ value: 'Male' }, { value: maleCount, center: true }, { value: `${malePct}%`, center: true }],
          [{ value: 'Female' }, { value: femaleCount, center: true }, { value: `${femalePct}%`, center: true }],
        ],
        accentColor: '#4a235a',
      },
      {
        title: 'ANATOMICAL SITE',
        headers: [
          { label: 'Site', align: 'left' },
          { label: 'Count', align: 'center' },
        ],
        rows: [
          [{ value: 'Pulmonary' }, { value: pulmonaryCount, center: true }],
          [{ value: 'Extra-Pulmonary' }, { value: extraPulmonaryCount, center: true }],
        ],
        accentColor: '#4a235a',
      },
    ],
    recommendations: `Deploy additional contact tracing teams. Increase active case finding. Strengthen treatment monitoring. Conduct monthly community screening.`,
  };
}

/* ─── Main Component ─── */
export default function Reports() {
  const { records, analytics, forecastData, resourceData } = useTBData();

  const [activeType, setActiveType] = useState('');
  const [reportData, setReportData] = useState(null);

  /* Monthly filters */
  const [month, setMonth] = useState('June');
  const [year, setYear] = useState('2025');
  const [brgy, setBrgy] = useState('');

  /* Quarterly filters */
  const [quarter, setQuarter] = useState('Q2');

  /* Barangay filters */
  const [brgyYear, setBrgyYear] = useState('2025');

  /* Annual filters */
  const [annualYear, setAnnualYear] = useState('2025');

  const handleGenerate = (type) => {
    let data;
    if (type === 'monthly') data = buildMonthlyReport(brgy || null, month, year, records, forecastData, analytics);
    else if (type === 'quarterly') data = buildQuarterlyReport(quarter, year, records, forecastData);
    else if (type === 'annual') data = buildAnnualReport(annualYear, records, forecastData);
    else if (type === 'barangay') data = buildBarangayReport(brgy || null, brgyYear, records, forecastData);
    setReportData(data);
  };

  const handlePrint = () => {
    const el = document.getElementById('printable-report');
    if (!el) return;
    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html><head><title>TB Report — TBInsight</title>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>body{font-family:'DM Sans',sans-serif;padding:32px;color:#1a202c;}@media print{body{padding:16px;}}</style>
    </head><body>${el.outerHTML}
    <script>window.onload=function(){window.print();}<\/script></body></html>`);
    w.document.close();
  };

  const handleDownload = () => {
    if (!reportData) return;
    const el = document.getElementById('printable-report');
    if (!el) return;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${reportData.title}</title>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>body{font-family:'DM Sans',sans-serif;padding:40px;max-width:900px;margin:auto;color:#1a202c;}</style>
    </head><body>${el.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = reportData.title.replace(/[^a-z0-9]/gi, '_') + '.html';
    a.click();
  };

  return (
    <div className="relative space-y-5">

      {/* ── Report Type Cards ── */}
      <section className="grid gap-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {REPORT_TYPES.map(r => (
          <div
            key={r.id}
            onClick={() => { setActiveType(activeType === r.id ? '' : r.id); setReportData(null); }}
            className="rounded-2xl p-5 cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background: activeType === r.id ? `${r.color}0A` : '#fff',
              border: `2px solid ${activeType === r.id ? r.color : '#e2e8f0'}`,
              boxShadow: activeType === r.id ? `0 4px 20px ${r.color}18` : '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3" style={{ background: r.color }}>
              <i className={`${r.icon} text-xl text-white`} />
            </div>
            <div className="text-sm font-bold" style={{ color: '#0f172a' }}>{r.title}</div>
            <div className="text-xs mt-1" style={{ color: '#64748b' }}>{r.desc}</div>
            <div className="text-[11px] font-semibold mt-1.5" style={{ color: r.color }}>{r.sub}</div>
          </div>
        ))}
      </section>

      {/* ── Monthly Filters ── */}
      {activeType === 'monthly' && (
        <section className="glass-card p-5">
          <div className="flex items-center gap-2 text-sm font-bold mb-4" style={{ color: '#0f172a' }}>
            <i className="ri-calendar-event-line" style={{ color: '#2E6FAF' }} />
            Monthly Report Options
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-xs font-semibold" style={{ color: '#475569' }}>Month:</span>
            <select value={month} onChange={e => setMonth(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              {['2025', '2024', '2023'].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-xs font-semibold" style={{ color: '#475569' }}>Barangay:</span>
            <select value={brgy} onChange={e => setBrgy(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a', minWidth: 190 }}>
              <option value="">All Barangays (City-wide)</option>
              {BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={() => handleGenerate('monthly')} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}>
              <i className="ri-eye-line text-sm" /> Generate & Preview
            </button>
          </div>
        </section>
      )}

      {/* ── Quarterly Filters ── */}
      {activeType === 'quarterly' && (
        <section className="glass-card p-5">
          <div className="flex items-center gap-2 text-sm font-bold mb-4" style={{ color: '#0f172a' }}>
            <i className="ri-calendar-todo-line" style={{ color: '#1a5276' }} />
            Quarterly Report Options
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-xs font-semibold" style={{ color: '#475569' }}>Quarter:</span>
            <select value={quarter} onChange={e => setQuarter(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              {QUARTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
            <select value={year} onChange={e => setYear(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              {['2025', '2024', '2023'].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => handleGenerate('quarterly')} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}>
              <i className="ri-eye-line text-sm" /> Generate & Preview
            </button>
          </div>
        </section>
      )}

      {/* ── Annual Filters ── */}
      {activeType === 'annual' && (
        <section className="glass-card p-5">
          <div className="flex items-center gap-2 text-sm font-bold mb-4" style={{ color: '#0f172a' }}>
            <i className="ri-calendar-line" style={{ color: '#7b2d00' }} />
            Annual Report Options
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-xs font-semibold" style={{ color: '#475569' }}>Year:</span>
            <select value={annualYear} onChange={e => setAnnualYear(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              {['2025', '2024', '2023'].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => handleGenerate('annual')} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}>
              <i className="ri-eye-line text-sm" /> Generate & Preview
            </button>
          </div>
        </section>
      )}

      {/* ── Barangay Filters ── */}
      {activeType === 'barangay' && (
        <section className="glass-card p-5">
          <div className="flex items-center gap-2 text-sm font-bold mb-4" style={{ color: '#0f172a' }}>
            <i className="ri-map-pin-line" style={{ color: '#4a235a' }} />
            Barangay Report Options
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-xs font-semibold" style={{ color: '#475569' }}>Barangay:</span>
            <select value={brgy} onChange={e => setBrgy(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a', minWidth: 200 }}>
              <option value="">All Barangays (Summary Table)</option>
              {BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={brgyYear} onChange={e => setBrgyYear(e.target.value)} className="rounded-lg px-3 py-2 text-xs font-medium outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              {['2025', '2024', '2023'].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => handleGenerate('barangay')} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white transition hover:opacity-90" style={{ background: 'linear-gradient(135deg, #0F2D52 0%, #2E6FAF 100%)' }}>
              <i className="ri-eye-line text-sm" /> Generate & Preview
            </button>
          </div>
        </section>
      )}

      {/* ── Hint when no type selected ── */}
      {!activeType && (
        <div className="glass-card p-12 text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)', boxShadow: '0 4px 14px rgba(99,102,241,0.15)' }}>
            <i className="ri-file-chart-line text-3xl" style={{ color: '#4f46e5' }} />
          </div>
          <div className="text-sm font-bold" style={{ color: '#0f172a' }}>Select a report type above to get started</div>
          <div className="text-xs mt-2" style={{ color: '#64748b' }}>Choose Monthly, Quarterly, Annual, or Barangay — then configure and preview</div>
        </div>
      )}

      {/* ── Generated Report Preview ── */}
      {reportData && (
        <div className="glass-card p-6">
          {/* Action Bar */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: '#0f172a' }}>
              <i className="ri-file-chart-line text-lg" style={{ color: '#2E6FAF' }} />
              <span>{reportData.title}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
                <i className="ri-printer-line text-sm" /> Print Report
              </button>
              <button onClick={handleDownload} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white transition hover:opacity-90" style={{ background: '#1a5276' }}>
                <i className="ri-download-2-line text-sm" /> Save as File
              </button>
            </div>
          </div>

          {/* ── Printable Report Container ── */}
          <div id="printable-report" style={{ fontFamily: "'DM Sans', sans-serif" }}>

            {/* ── Report Header ── */}
            <div style={{ textAlign: 'center', borderBottom: `3px solid ${reportData.headerColor}`, paddingBottom: 16, marginBottom: 20 }}>
              <div style={{ fontSize: '.8rem', color: '#666', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>
                Republic of the Philippines · Pasig City Health Office
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: reportData.headerColor }}>
                {reportData.headerTitle}
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: 4 }}>
                {reportData.subtitle}
              </div>
              <div style={{ fontSize: '.78rem', color: '#888', marginTop: 6 }}>
                Generated by TBInsight Dashboard · Date Printed: June 15, 2025
              </div>
            </div>

            {/* ── KPI Row ── */}
            {reportData.showKpiRow !== false && reportData.kpis && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
                {reportData.kpis.map(k => (
                  <div key={k.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: '.75rem', color: '#718096', marginTop: 2 }}>{k.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Info Banner (Barangay Detail) ── */}
            {reportData.infoBanner && (
              <div style={{ background: '#f3e8ff', border: '1px solid #c084fc', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: '.85rem', display: 'flex', gap: 24 }}>
                <span><strong>Barangay:</strong> {reportData.infoBanner.brgy}</span>
                <span><strong>Risk Level:</strong> <span style={{ color: reportData.infoBanner.risk === 'High' ? '#e74c3c' : reportData.infoBanner.risk === 'Moderate' ? '#f39c12' : '#27ae60', fontWeight: 800 }}>{reportData.infoBanner.risk}</span></span>
                <span><strong>Total Cases:</strong> {reportData.infoBanner.cases}</span>
                <span><strong>Active:</strong> {reportData.infoBanner.active}</span>
                <span><strong>Success Rate:</strong> {reportData.infoBanner.success}%</span>
              </div>
            )}

            {/* ── Risk Banner (Monthly) ── */}
            {reportData.riskBanner && (
              <div style={{ ...reportData.riskBannerStyle, borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: '.85rem' }}>
                <strong>{reportData.riskBanner.label}:</strong> {reportData.riskBanner.value} &nbsp;|&nbsp;{' '}
                <strong>Risk Level:</strong>{' '}
                <span style={{ color: reportData.riskBanner.risk === 'High' ? '#e74c3c' : reportData.riskBanner.risk === 'Moderate' ? '#f39c12' : '#27ae60', fontWeight: 800 }}>
                  {reportData.riskBanner.risk}
                </span> &nbsp;|&nbsp;{' '}
                <strong>Priority Rank:</strong> {reportData.riskBanner.rank}
              </div>
            )}

            {/* ── Tables ── */}
            {reportData.tables.map((table, ti) => (
              <div key={ti} style={{ marginBottom: 16 }}>
                {table.title && (
                  <div style={S.sectionTitle}>{table.title}</div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.83rem' }}>
                  <thead>
                    <tr style={{ background: table.accentColor, color: '#fff' }}>
                      {table.headers.map((h, hi) => (
                        <th key={hi} style={{
                          padding: '8px 12px',
                          textAlign: h.align === 'center' ? 'center' : 'left',
                          fontWeight: 700,
                        }}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, ri) => (
                      <tr key={ri} style={{ background: S.rowBg(ri) }}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid #e2e8f0',
                            textAlign: cell.center ? 'center' : 'left',
                            fontWeight: cell.bold ? 700 : 400,
                            fontSize: cell.muted ? '.8rem' : undefined,
                            color: cell.muted ? '#718096' : cell.color || undefined,
                          }}>
                            {cell.risk ? <RiskBadge risk={cell.value} /> : cell.value}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {table.totalRow && (
                      <tr style={S.totalRow}>
                        <td style={{ padding: '8px 12px' }}>{table.totalRow.label}</td>
                        {table.totalRow.values.map((v, vi) => (
                          <td key={vi} style={{ padding: '8px 12px', textAlign: 'center' }}>{v.value}</td>
                        ))}
                        {table.headers.length > table.totalRow.values.length + 1 && <td />}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}

            {/* ── All Barangays Table (Annual) ── */}
            {reportData.allBarangaysTable && (() => {
              const t = reportData.allBarangaysTable;
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={S.sectionTitle}>{t.title}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: t.compact ? '.8rem' : '.83rem' }}>
                    <thead>
                      <tr style={{ background: t.accentColor, color: '#fff' }}>
                        {t.headers.map((h, hi) => (
                          <th key={hi} style={{
                            padding: t.compact ? '7px 10px' : '8px 12px',
                            textAlign: h.align === 'center' ? 'center' : 'left',
                            fontWeight: 700,
                          }}>{h.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: S.rowBg(ri) }}>
                          {row.map((cell, ci) => (
                            <td key={ci} style={{
                              padding: t.compact ? '6px 10px' : '8px 12px',
                              borderBottom: '1px solid #e2e8f0',
                              textAlign: cell.center ? 'center' : 'left',
                              fontWeight: cell.bold ? 700 : 400,
                              color: cell.color || undefined,
                            }}>
                              {cell.risk ? <RiskBadge risk={cell.value} /> : cell.value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* ── Side by Side (Monthly / Barangay Detail) ── */}
            {reportData.sideBySide && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                {reportData.sideBySide.map((section, si) => (
                  <div key={si}>
                    <div style={S.sectionTitle}>{section.title}</div>
                    {section.type === 'keyValue' ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.83rem' }}>
                        <tbody>
                          {section.rows.map(([k, v], ri) => (
                            <tr key={ri} style={{ background: ri % 2 ? '#f8fafc' : '#fff' }}>
                              <td style={{ padding: '7px 12px', borderBottom: '1px solid #e2e8f0' }}>{k}</td>
                              <td style={{
                                padding: '7px 12px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700,
                                color: k.includes('Achieved') && section.successRate < 85 ? '#e74c3c' : k.includes('Achieved') && section.successRate >= 85 ? '#27ae60' : undefined,
                              }}>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.83rem' }}>
                        <thead>
                          <tr style={{ background: section.accentColor, color: '#fff' }}>
                            {section.headers.map((h, hi) => (
                              <th key={hi} style={{
                                padding: '7px 12px',
                                textAlign: h.align === 'center' ? 'center' : 'left',
                              }}>{h.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row, ri) => (
                            <tr key={ri} style={{ background: S.rowBg(ri) }}>
                              {row.map((cell, ci) => (
                                <td key={ci} style={{
                                  padding: '7px 12px',
                                  borderBottom: '1px solid #e2e8f0',
                                  textAlign: cell.center ? 'center' : 'left',
                                  fontWeight: cell.bold ? 700 : 400,
                                }}>{cell.value}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Recommendations (yellow box) ── */}
            {reportData.recommendations && (
              <div style={{ background: '#fff3cd', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 16px', fontSize: '.83rem', marginBottom: 16 }}>
                <strong>Recommendations:</strong> {reportData.recommendations}
              </div>
            )}

            {/* ── Report Footer ── */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '2px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', color: '#999' }}>
              <span>TBInsight Dashboard · Pasig City Health Office</span>
              <span>{reportData.footerPeriod} · Printed: June 15, 2025</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
