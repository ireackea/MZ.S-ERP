// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Runtime Recovery Hardening - 2026-02-28
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';

interface Props {
  children?: ReactNode;
  fallbackTitle?: string;
  className?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    this.setState({ errorInfo });
  }

  public handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    setTimeout(() => window.location.reload(), 100);
  };

  public handleClearStorage = () => {
    localStorage.clear();
    sessionStorage.clear();
    this.handleRetry();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className={`min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4 ${this.props.className || ''}`}
          dir="rtl"
        >
          <div className="w-full max-w-2xl">
            <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-red-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 px-8 py-6 text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-full mb-4">
                  <AlertTriangle size={40} className="text-white" />
                </div>
                <h1 className="text-2xl font-black text-white mb-2">
                  {this.props.fallbackTitle || 'حدث خطأ غير متوقع'}
                </h1>
                <p className="text-red-100 text-sm font-medium">
                  تعذر عرض هذه الشاشة. يمكنك إعادة المحاولة أو مسح بيانات الجلسة المحلية.
                </p>
              </div>

              <div className="px-8 py-6 space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Bug size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-red-800 mb-1">رسالة الخطأ:</h3>
                      <p className="text-sm text-red-700 font-mono break-all">
                        {this.state.error?.message || 'لا توجد تفاصيل إضافية'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={this.handleRetry}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-3 font-semibold hover:bg-slate-800 transition-colors"
                  >
                    <RefreshCw size={16} />
                    إعادة المحاولة
                  </button>

                  <button
                    type="button"
                    onClick={this.handleClearStorage}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 text-white px-4 py-3 font-semibold hover:bg-red-700 transition-colors"
                  >
                    مسح التخزين المحلي
                  </button>
                </div>

                {process.env.NODE_ENV === 'development' && (
                  <details className="bg-slate-900 text-slate-100 rounded-xl p-4 mt-4">
                    <summary className="text-sm font-bold cursor-pointer">تفاصيل المطور</summary>
                    <div className="mt-3 text-xs font-mono space-y-2">
                      <div>
                        <strong className="text-slate-400">Error Name:</strong>
                        <p className="text-slate-200">{this.state.error?.name}</p>
                      </div>
                      <div>
                        <strong className="text-slate-400">Error Stack:</strong>
                        <pre className="text-slate-300 whitespace-pre-wrap break-all mt-1 bg-slate-800 p-2 rounded">
                          {this.state.error?.stack}
                        </pre>
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;