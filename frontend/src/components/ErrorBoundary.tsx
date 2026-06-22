import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React Error Boundary Caught Error]:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] p-6 text-center">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 max-w-md w-full shadow-lg space-y-6">
            <div className="w-16 h-16 bg-red-50 border border-red-100 rounded-full flex items-center justify-center mx-auto text-[#EF4444] animate-pulse">
              <AlertTriangle size={32} />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-[#0F172A]">Something went wrong</h2>
              <p className="text-sm text-[#64748B]">
                We encountered an unexpected interface error. Don't worry, your ledger records are safe in the database.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-left text-xs font-mono text-[#475569] max-h-32 overflow-y-auto">
                <span className="font-bold text-[#0F172A]">Error:</span> {this.state.error.message}
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 bg-[#10B981] hover:bg-[#059669] text-white font-semibold py-3 rounded-xl shadow-md transition-all duration-300 cursor-pointer"
            >
              <RefreshCw size={16} />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
