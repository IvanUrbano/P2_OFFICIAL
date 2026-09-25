export default function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <i className="ri-error-warning-line text-4xl mb-4" style={{ color: '#F87171' }} />
      <h3 className="text-sm font-bold mb-1" style={{ color: '#0F2D52' }}>Unable to Load Data</h3>
      <p className="text-xs text-center max-w-sm mb-4" style={{ color: '#94A3B8' }}>
        {message || 'Something went wrong while retrieving the data.'}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-xs font-semibold rounded-lg transition-colors"
          style={{ background: '#0F2D52', color: '#ffffff' }}
        >
          Try Again
        </button>
      )}
    </div>
  );
}
