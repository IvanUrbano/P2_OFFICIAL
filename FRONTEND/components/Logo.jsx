/**
 * TBInsight Logo — SVG shield with lungs motif.
 * Accepts a `size` prop (default 32) to control width/height.
 */
export default function Logo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield shape */}
      <path
        d="M32 4L8 14v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V14L32 4z"
        fill="url(#shield-gradient)"
      />
      {/* Lungs motif */}
      <path
        d="M24 24c-2 0-4 1-5.5 3-1.5 2-2 4.5-1.5 7 .5 2.5 2 4.5 4 5.5l1 2c1 2 1.5 4 1 6-.5 2-2 3.5-4 3.5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M40 24c2 0 4 1 5.5 3 1.5 2 2 4.5 1.5 7-.5 2.5-2 4.5-4 5.5l-1 2c-1 2-1.5 4-1 6 .5 2 2 3.5 4 3.5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Trachea */}
      <line
        x1="32" y1="20" x2="32" y2="36"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Trachea branches */}
      <line x1="32" y1="36" x2="27" y2="40" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="36" x2="37" y2="40" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <defs>
        <linearGradient id="shield-gradient" x1="32" y1="4" x2="32" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2E6FAF" />
          <stop offset="1" stopColor="#0F2D52" />
        </linearGradient>
      </defs>
    </svg>
  );
}
