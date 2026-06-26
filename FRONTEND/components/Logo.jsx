/**
 * TBInsight Logo — Heart composed of fragmented GIS map polygons
 * with geographic boundaries, data nodes, and a location pin.
 * Optimized for dark navy sidebar (#0F2D52). Light colors for contrast.
 * Flat design, no text, transparent background.
 */
export default function Logo({ size = 48, className = '' }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <defs>
                <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4FD1C5" />
                    <stop offset="100%" stopColor="#00D8F6" />
                </linearGradient>
                <linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0066FF" />
                    <stop offset="100%" stopColor="#4FD1C5" />
                </linearGradient>
                <linearGradient id="lg3" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#00D8F6" />
                    <stop offset="100%" stopColor="#0066FF" />
                </linearGradient>
                <linearGradient id="lgPin" x1="50%" y1="0%" x2="50%" y2="100%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#b2dfdb" />
                </linearGradient>
            </defs>

            <g>
                {/* Zone 1 — top-left lobe */}
                <path
                    d="M30 8 C20 8, 8 16, 8 30 C8 40, 14 48, 22 54 L38 38 L50 22 L50 14 L42 10Z"
                    fill="url(#lg2)"
                    opacity="0.85"
                />

                {/* Zone 2 — top-right lobe */}
                <path
                    d="M70 8 C80 8, 92 16, 92 30 C92 40, 86 48, 78 54 L62 38 L50 22 L50 14 L58 10Z"
                    fill="url(#lg1)"
                    opacity="0.9"
                />

                {/* Zone 3 — center-upper */}
                <path
                    d="M50 14 L42 10 L30 8 L38 28 L50 38 L62 28 L70 8 L58 10Z"
                    fill="url(#lg3)"
                    opacity="0.7"
                />

                {/* Zone 4 — left mid */}
                <path
                    d="M22 54 L38 38 L50 38 L44 60 L30 68 L16 62Z"
                    fill="#4FD1C5"
                    opacity="0.6"
                />

                {/* Zone 5 — right mid */}
                <path
                    d="M78 54 L62 38 L50 38 L56 60 L70 68 L84 62Z"
                    fill="#00D8F6"
                    opacity="0.55"
                />

                {/* Zone 6 — lower center */}
                <path
                    d="M50 38 L44 60 L50 82 L56 60Z"
                    fill="#0066FF"
                    opacity="0.5"
                />

                {/* Zone 7 — bottom-left */}
                <path
                    d="M30 68 L44 60 L50 82 L38 80 L22 72Z"
                    fill="#4FD1C5"
                    opacity="0.4"
                />

                {/* Zone 8 — bottom-right */}
                <path
                    d="M70 68 L56 60 L50 82 L62 80 L78 72Z"
                    fill="#00D8F6"
                    opacity="0.35"
                />

                {/* Geographic boundary lines */}
                <g stroke="rgba(255,255,255,0.5)" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="10" y1="30" x2="50" y2="38" strokeWidth="1.2" />
                    <line x1="90" y1="30" x2="50" y2="38" strokeWidth="1.2" />
                    <line x1="50" y1="14" x2="50" y2="38" strokeWidth="1.2" />
                    <line x1="50" y1="38" x2="50" y2="82" strokeWidth="1" />
                    <line x1="30" y1="8" x2="50" y2="38" strokeWidth="0.8" opacity="0.6" />
                    <line x1="70" y1="8" x2="50" y2="38" strokeWidth="0.8" opacity="0.6" />
                    <line x1="22" y1="54" x2="50" y2="82" strokeWidth="0.7" opacity="0.5" />
                    <line x1="78" y1="54" x2="50" y2="82" strokeWidth="0.7" opacity="0.5" />
                    <line x1="30" y1="68" x2="70" y2="68" strokeWidth="0.7" opacity="0.4" />
                </g>

                {/* Data nodes */}
                <g>
                    <line x1="28" y1="26" x2="40" y2="20" stroke="#4FD1C5" strokeWidth="0.6" opacity="0.7" />
                    <line x1="60" y1="20" x2="72" y2="26" stroke="#4FD1C5" strokeWidth="0.6" opacity="0.7" />
                    <line x1="36" y1="50" x2="50" y2="38" stroke="#4FD1C5" strokeWidth="0.5" opacity="0.5" />
                    <line x1="64" y1="50" x2="50" y2="38" stroke="#4FD1C5" strokeWidth="0.5" opacity="0.5" />

                    <circle cx="28" cy="26" r="2.5" fill="#4FD1C5" />
                    <circle cx="40" cy="20" r="2" fill="#00D8F6" />
                    <circle cx="60" cy="20" r="2" fill="#00D8F6" />
                    <circle cx="72" cy="26" r="2.5" fill="#4FD1C5" />
                    <circle cx="36" cy="50" r="1.8" fill="#4FD1C5" opacity="0.7" />
                    <circle cx="64" cy="50" r="1.8" fill="#4FD1C5" opacity="0.7" />
                </g>

                {/* Location pin */}
                <g transform="translate(50, 42)">
                    <ellipse cx="0" cy="14" rx="5" ry="2" fill="rgba(0,0,0,0.2)" />
                    <path
                        d="M0 -10 C-5.5 -10, -10 -5.5, -10 0 C-10 6, 0 14, 0 14 C0 14, 10 6, 10 0 C10 -5.5, 5.5 -10, 0 -10Z"
                        fill="url(#lgPin)"
                        stroke="rgba(255,255,255,0.4)"
                        strokeWidth="0.8"
                    />
                    <circle cx="0" cy="-1" r="3.5" fill="#00D8F6" />
                    <circle cx="0" cy="-1" r="1.8" fill="#ffffff" opacity="0.7" />
                </g>
            </g>
        </svg>
    );
}
