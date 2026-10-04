import { useCallback, useEffect, useRef, useState } from 'react';
import { secondaryBtn } from './SidePanel';

function ConfirmDialog({ options, onResolve }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onResolve(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onResolve]);

  const danger = options.variant === 'danger';
  const confirmStyle = danger
    ? { background: '#B91C1C', color: '#ffffff', border: '1px solid #B91C1C', borderRadius: 4 }
    : { background: '#0F2D52', color: '#ffffff', border: '1px solid #0F2D52', borderRadius: 4 };

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => onResolve(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}>
        <h2 id="confirm-dialog-title" className="text-sm font-bold" style={{ color: '#0F2D52' }}>{options.title}</h2>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: '#475569' }}>{options.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" autoFocus onClick={() => onResolve(false)} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>
            {options.cancelLabel || 'Cancel'}
          </button>
          <button type="button" onClick={() => onResolve(true)} className="px-4 py-2 text-xs font-semibold" style={confirmStyle}>
            {options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [options, setOptions] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((nextOptions) => new Promise(resolve => {
    resolveRef.current = resolve;
    setOptions(nextOptions);
  }), []);

  const resolve = useCallback((answer) => {
    const pending = resolveRef.current;
    resolveRef.current = null;
    setOptions(null);
    pending?.(answer);
  }, []);

  useEffect(() => () => resolveRef.current?.(false), []);

  return {
    confirm,
    confirmDialog: options ? <ConfirmDialog options={options} onResolve={resolve} /> : null,
  };
}