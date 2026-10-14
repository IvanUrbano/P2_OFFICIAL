function formatWholeNumber(value) {
  return Math.floor(Number(value)).toLocaleString('en-US');
}

function formatPercentile(value) {
  const rounded = Number(value).toFixed(1);
  const whole = Math.floor(Number(value));
  const lastTwo = whole % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' }[whole % 10] || 'th');
  return `${rounded}${suffix}`;
}

function buildCalculationTooltip(source, percentiles) {
  let explanation;
  switch (source) {
    case 'tertile_incidence':
      explanation = 'TBInsight automatically calculates these ranges from TB incidence across barangays in the current assessment.';
      break;
    case 'tertile_features':
      explanation = 'The ML service was unavailable, so TBInsight calculated these ranges from the assessment’s TB incidence data.';
      break;
    case 'override':
      explanation = 'These ranges were set manually for this assessment.';
      break;
    case 'default':
      explanation = 'Fallback ranges were used because the assessment did not provide enough data to calculate them.';
      break;
    default:
      explanation = 'TBInsight calculates these ranges from the current assessment data.';
  }

  const lowPercentile = Number(percentiles?.low_pct);
  const moderatePercentile = Number(percentiles?.med_pct);
  if (Number.isFinite(lowPercentile) && Number.isFinite(moderatePercentile)) {
    explanation += ` The boundaries use the ${formatPercentile(lowPercentile)} and ${formatPercentile(moderatePercentile)} percentiles.`;
  }
  return explanation;
}

export default function RiskClassificationGuide({ thresholds, source, percentiles }) {
  const lowMaximum = Number(thresholds?.low_max);
  const moderateMaximum = Number(thresholds?.med_max);
  if (!Number.isFinite(lowMaximum) || !Number.isFinite(moderateMaximum)) return null;

  const lowMaximumDisplay = Math.floor(lowMaximum);
  const moderateMaximumDisplay = Math.floor(moderateMaximum);
  const tooltip = buildCalculationTooltip(source, percentiles);
  const guideNote = source === 'override'
    ? 'These ranges are set for this assessment to compare barangays. They are not official DOH risk levels.'
    : source === 'default'
      ? 'Fallback ranges are shown for this assessment to compare barangays. They are not official DOH risk levels.'
      : 'Automatically calculated from the current TBInsight assessment to compare barangays. These are comparative classifications, not official DOH risk levels.';

  return (
    <section className="mt-3 pt-3" style={{ borderTop: '1px solid #E2E8F0' }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-[11px] font-bold" style={{ color: '#475569' }}>
          Incidence ranges for comparison
        </h3>
        <span
          className="text-[10px]"
          style={{ color: '#94A3B8' }}
          title={tooltip}
          aria-label={`How is this calculated? ${tooltip}`}
          role="img"
          tabIndex={0}
        >
          ⓘ How is this calculated?
        </span>
      </div>
      <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>
        TB incidence per 100,000. The risk level above comes from the Random Forest, which also weighs trends, neighbouring barangays and long-term history, so it can differ from these ranges.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-1 mt-1">
        <p className="text-[11px] font-semibold" style={{ color: '#B45309' }}>
          🟡 Low: ≤ {formatWholeNumber(lowMaximumDisplay)}
        </p>
        <p className="text-[11px] font-semibold" style={{ color: '#C2410C' }}>
          🟠 Moderate: {formatWholeNumber(lowMaximumDisplay + 1)}–{formatWholeNumber(moderateMaximumDisplay)}
        </p>
        <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>
          🔴 High: &gt; {formatWholeNumber(moderateMaximumDisplay)}
        </p>
      </div>
      <p className="text-[10px] mt-1 leading-snug" style={{ color: '#64748B' }}>
        {guideNote}
      </p>
    </section>
  );
}
