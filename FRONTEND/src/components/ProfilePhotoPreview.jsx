import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ModalCloseButton from './ModalCloseButton';

export default function ProfilePhotoPreview({ photo, onClose }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        event.preventDefault();
        dialogRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-[#0B1D35]/70 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Profile photo" className="w-full max-w-[380px] overflow-hidden rounded-lg border border-[#DCE4EC] bg-white shadow-xl outline-none">
        <div className="flex items-center justify-between bg-[#0F2D52] px-4 py-2.5">
          <h2 className="text-sm font-semibold text-white">Profile photo</h2>
          <ModalCloseButton onClick={onClose} light label="Close profile photo" />
        </div>
        <div className="flex justify-center p-5">
          <img src={photo} alt="Your profile" className="aspect-square w-full max-w-[320px] rounded-md object-cover" />
        </div>
      </div>
    </div>,
    document.body
  );
}
