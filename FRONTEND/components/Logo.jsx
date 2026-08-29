/**
 * TBInsight Logo — Clean medical shield icon.
 * Accepts a `size` prop (default 32) to control width/height.
 */
export default function Logo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield */}
      <path
        d="M16 2L4 7v9c0 7.2 5.12 13.92 12 16 6.88-2.08 12-8.8 12-16V7L16 2z"
        fill="#0F2D52"
      />
      {/* Cross */}
      <rect x="14" y="8" width="4" height="12" rx="1" fill="#ffffff" />
      <rect x="10" y="12" width="12" height="4" rx="1" fill="#ffffff" />
    </svg>
  );
}
