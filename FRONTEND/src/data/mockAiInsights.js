export const MOCK_ANALYTICS_INSIGHT = {
  type: 'analytics',

  sections: [
    {
      id: 'keyTrend',
      title: 'Key Trend',
      icon: '\ud83d\udcc8',
      text: 'TB cases show an increasing trend of 18.4% over the last 3 months (320 cases) compared with the prior 3 months (270 cases).',
    },

    {
      id: 'highestLowest',
      title: 'Highest / Lowest',
      icon: '\ud83d\udcca',
      text: 'Barangay San Jose recorded the highest case count (45 cases), while Barangay Oranbo recorded the lowest (3 cases).',
    },

    {
      id: 'significantChanges',
      title: 'Significant Changes',
      icon: '\u26a0\ufe0f',
      text: 'Barangay Manggahan showed a notable 32% increase in August, with cases exceeding its historical average by 2.1 standard deviations.',
    },

    {
      id: 'riskFindings',
      title: 'Risk Findings',
      icon: '\ud83c\udfaf',
      text: '4 barangays are classified as high-risk: San Jose, Manggahan, Pinagbuhatan, and Sta. Cruz.',
    },

    {
      id: 'demographics',
      title: 'Demographics',
      icon: '\ud83d\udc65',
      text: 'Males account for 62% of reported cases. The 25\u201344 age group represents the largest demographic at 38%.',
    },

    {
      id: 'treatment',
      title: 'Treatment',
      icon: '\ud83d\udc8a',
      text: 'Treatment success rate is 82%, below the DOH target of 85%.',
    },

    {
      id: 'overallSummary',
      title: 'Overall Summary',
      icon: '\ud83d\udcdd',
      text: 'TB activity is increasing during the selected period, with 4 barangays classified as high-risk. Treatment success remains below the 85% target, indicating areas that may require closer monitoring.',
    },
  ],

  meta: {
    basedOn: 'August 2026 \u2022 All Barangays',
    generatedAt: '2026-09-07T22:30:00Z',
  },
};


export const MOCK_FORECASTING_INSIGHT = {
  type: 'forecasting',

  sections: [
    {
      id: 'forecastDirection',
      title: 'Forecast Direction',
      icon: '\ud83d\udcc8',
      text: 'The forecast indicates an increasing trend in TB cases over the next 3 months.',
    },

    {
      id: 'predictedCases',
      title: 'Predicted Cases',
      icon: '\ud83d\udd2e',
      text: 'A total of 228 TB cases are forecasted for the next 3 months, with an average of 76 cases per month.',
    },

    {
      id: 'peakPeriod',
      title: 'Peak Period',
      icon: '\ud83d\udcc5',
      text: 'The highest forecasted case count is expected in November 2026, with approximately 82 cases.',
    },

    {
      id: 'growthRate',
      title: 'Growth Rate',
      icon: '\ud83d\udcca',
      text: 'The forecast shows an estimated monthly growth rate of 4.8%.',
    },

    {
      id: 'highRiskAreas',
      title: 'High-Risk Areas',
      icon: '\ud83c\udfaf',
      text: '4 barangays are currently classified as high-risk based on the latest risk classification results.',
    },

    {
      id: 'confidence',
      title: 'Forecast Confidence',
      icon: '\ud83d\udcd0',
      text: 'The forecast intervals indicate moderate confidence in the projected values.',
    },

    {
      id: 'overallSummary',
      title: 'Overall Summary',
      icon: '\ud83d\udcdd',
      text: 'TB cases are projected to increase over the next 3 months, with the highest forecast expected in November 2026. Continued monitoring of high-risk barangays is recommended as projected cases rise.',
    },
  ],

  meta: {
    basedOn: 'August 2026 \u2022 3-Month Forecast',
    generatedAt: '2026-09-07T22:30:00Z',
  },
};


export const MOCK_DASHBOARD_INSIGHT = {
  type: 'dashboard',

  summary:
    'TB activity is increasing during the current monitoring period, with several barangays classified as high-risk. Treatment success remains below the 85% target, indicating areas that may require closer monitoring and intervention.',

  metrics: [
    {
      value: '\u2191 18.4%',
      label: 'TB Case Trend',
    },
    {
      value: '4',
      label: 'High-Risk Barangays',
    },
    {
      value: '82%',
      label: 'Treatment Success',
    },
  ],

  meta: {
    basedOn: 'August 2026 \u2022 Pasig City',
    generatedAt: '2026-09-07T22:30:00Z',
  },
};
