import { useState, useEffect, useRef, useLayoutEffect } from 'react';

/* ─── Row action menu (opened from the ⋮ button) ───
   Rendered with fixed positioning so the table's horizontal scroll container
   can't clip it; flips upward when there isn't room below. */
export default function RowMenu({ anchor, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const menu = ref.current;
    const h = menu ? menu.offsetHeight : 240;
    const w = menu ? menu.offsetWidth : 208;
    const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 8);
    const spaceAbove = Math.max(0, r.top - 8);
    const placeAbove = h > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = placeAbove ? spaceAbove : spaceBelow;
    const menuHeight = Math.min(h, availableHeight);
    const top = placeAbove ? r.top - menuHeight - 4 : r.bottom + 4;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    setPos({ top, left, maxHeight: availableHeight });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[1250] w-52 max-w-[calc(100vw-16px)] overflow-y-auto py-1"
      style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight, background: '#ffffff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 6px 20px rgba(15,23,42,0.10)' }}
    >
      {items.map((item, i) => item.divider ? (
        <div key={`d${i}`} className="my-1" style={{ borderTop: '1px solid #F1F5F9' }} />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          title={item.disabled ? item.reason : undefined}
          onClick={() => { onClose(); item.onClick(); }}
          className="w-full flex items-start gap-2.5 px-3 py-[7px] text-left text-xs disabled:cursor-not-allowed"
          style={{ color: item.disabled ? '#CBD5E1' : item.danger ? '#B91C1C' : '#334155' }}
          onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = item.danger ? '#FEF2F2' : '#F8FAFC'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <i className={`${item.icon} text-[15px] leading-4 mt-px`} style={{ color: item.disabled ? '#E2E8F0' : item.danger ? '#DC2626' : '#94A3B8' }} />
          <span className="flex-1 min-w-0">
            <span className="block">{item.label}</span>
            {item.disabled && item.reason && <span className="block text-[10px] mt-0.5" style={{ color: '#CBD5E1' }}>{item.reason}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
