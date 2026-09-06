import { Component } from 'react';

class ErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full flex items-center justify-center" style={{ background: '#f0f4f8' }}>
          <div className="text-center max-w-md px-8">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: '#FEE2E2' }}>
              <i className="ri-error-warning-line text-2xl" style={{ color: '#EF4444' }} />
            </div>
            <h1 className="text-lg font-extrabold mb-2" style={{ color: '#0F2D52' }}>Something went wrong</h1>
            <p className="text-sm mb-1" style={{ color: '#64748B' }}>An unexpected error occurred. Please try refreshing the page.</p>
            <p className="text-[11px] mb-6" style={{ color: '#94A3B8' }}>{this.state.error?.message}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-semibold rounded-lg"
                style={{ background: '#0F2D52', color: '#ffffff' }}
              >
                Refresh Page
              </button>
              <button
                onClick={() => { window.location.href = '/login'; }}
                className="px-4 py-2 text-xs font-semibold rounded-lg"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}
              >
                Go to Login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function ErrorBoundary({ children }) {
  return <ErrorBoundaryInner>{children}</ErrorBoundaryInner>;
}
