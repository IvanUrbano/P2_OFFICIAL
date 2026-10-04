/* Right-side panel — same look as TBInsight's side panels (navy header, slide-in,
   buttons right under the content). Renders a <form> when onSubmit is given. */
export const primaryBtn = { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 };
export const secondaryBtn = { background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 4 };

export default function SidePanel({ title, subtitle, badge, onClose, onSubmit, footer, children, width = 'max-w-lg', footerDivider = false }) {
  const Shell = onSubmit ? 'form' : 'div';
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(4px)' }} />
      <Shell
        className={`relative w-full ${width} h-full flex flex-col`}
        style={{ background: '#ffffff', animation: 'slide-in-right 0.3s ease-out both', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ background: '#0F2D52' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold truncate" style={{ color: '#ffffff' }}>{title}</p>
              {badge}
            </div>
            {subtitle && <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8 }}>
            <i className="ri-close-line text-base" />
          </button>
        </div>
        {/* With footerDivider the content stretches (flex-1) so the footer sits pinned
            at the panel bottom — and pb-6 keeps clear air between the last detail and
            the divider instead of the default pb-0 (which touched it). */}
        <div className={`min-h-0 overflow-y-auto space-y-4 p-6 ${footerDivider ? 'flex-1 pb-6' : 'pb-0'}`}>{children}</div>
        {footer && (
          <div
            className={`shrink-0 px-6 pt-5 pb-6 flex items-center gap-2${footerDivider ? ' border-t justify-end' : ''}`}
            style={{ background: '#ffffff', ...(footerDivider ? { borderColor: '#E2E8F0' } : {}) }}
          >
            {footer}
          </div>
        )}
      </Shell>
    </div>
  );
}
