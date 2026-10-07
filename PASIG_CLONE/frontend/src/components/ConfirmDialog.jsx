import { useCallback, useEffect, useRef, useState } from 'react';
import ModalCloseButton from './ModalCloseButton';
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
  const hasHeaderTone = Boolean(options.headerTone) || /^(delete|remove)\b/i.test(options.title || '');

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => onResolve(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="w-full max-w-sm overflow-hidden border border-gray-200 bg-white shadow-lg" style={{ borderRadius: hasHeaderTone ? 5 : 12 }} onClick={event => event.stopPropagation()}>
        {hasHeaderTone ? (
          <div className="flex items-center justify-between px-5 py-4" style={{ background: options.headerTone || '#0F2D52' }}>
            <h2 id="confirm-dialog-title" className="text-sm font-semibold text-white">{options.title}</h2>
            <ModalCloseButton onClick={() => onResolve(false)} light />
          </div>
        ) : (
          <h2 id="confirm-dialog-title" className="px-6 pt-6 text-sm font-bold" style={{ color: '#0F2D52' }}>{options.title}</h2>
        )}
        <div className={hasHeaderTone ? 'px-5 py-4' : 'px-6 pt-2'}>
          <p className="text-xs leading-5" style={{ color: '#475569' }}>{options.message}</p>
        </div>
        <div className={`flex justify-end gap-2 border-t border-gray-200 ${hasHeaderTone ? 'px-5 py-3' : 'mx-6 mb-6 mt-5 pt-4'}`}>
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
