export default function ModalCloseButton({ onClick, light = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-lg font-normal leading-none transition-opacity hover:opacity-70"
      style={{ color: light ? '#ffffff' : '#64748B' }}
    >
      X
    </button>
  );
}
