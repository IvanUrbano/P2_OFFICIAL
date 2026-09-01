/**
 * TBInsight Logo — Supports icon-only and banner variants.
 * @param {"icon"|"banner"} variant - "icon" for the standalone emblem, "banner" for the full logo with text.
 * @param {number} width - Image width in pixels.
 * @param {string} className - Additional CSS classes.
 */
const LOGO_SRC = {
  icon: '/images/tbinsight-icon.png',
  banner: '/images/tbinsight-logo.png',
};

export default function Logo({ variant = 'banner', width = 180, className = '' }) {
  return (
    <img
      src={LOGO_SRC[variant]}
      alt="TBInsight Logo"
      className={`h-auto ${className}`}
      style={{ width: `${width}px` }}
    />
  );
}
