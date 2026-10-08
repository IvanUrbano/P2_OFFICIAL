export default function ModalCloseButton({ onClick, light = false, label = 'Close', ref }) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-lg font-normal leading-none transition-opacity hover:opacity-70"
      style={{ color: light ? '#ffffff' : '#64748B' }}
    >
      X
    </button>
  );
}
