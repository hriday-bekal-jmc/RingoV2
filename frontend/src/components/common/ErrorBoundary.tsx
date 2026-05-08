// Top-level error boundary. Catches any uncaught render error so the SPA
// doesn't white-screen. User sees a friendly fallback with a reload button.
//
// React error boundaries only catch:
//   - Render-phase errors in descendants
//   - Lifecycle method errors
//   - Constructor errors
// They do NOT catch async errors, event handlers, or errors in the boundary
// itself — those should be handled with try/catch + toast in the calling code.

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    // Update state so next render shows fallback
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production, route this to a logging service (Sentry / DataDog / CloudWatch).
    // For now, console.error is fine — gives ops something to work with from browser logs.
    console.error('[ErrorBoundary] uncaught render error:', error, info.componentStack);
  }

  handleReload = (): void => {
    // Hard reload — clears any corrupted in-memory state
    window.location.reload();
  };

  handleGoHome = (): void => {
    // Soft recovery — navigate home and reset boundary state
    this.setState({ hasError: false, error: null });
    window.location.href = '/dashboard';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-cream-100 px-6">
          <div className="max-w-md w-full glass rounded-3xl p-8 space-y-5 text-center">
            <div className="text-5xl">🍎</div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold text-warmgray-800">
                予期しないエラーが発生しました
              </h1>
              <p className="text-sm text-warmgray-500">
                ページの再読み込みをお試しください。問題が続く場合は管理者にお問い合わせください。
              </p>
            </div>

            {/* Error detail — collapsed by default; helps support diagnose */}
            {this.state.error && (
              <details className="text-left bg-surface-100/60 rounded-xl px-4 py-3">
                <summary className="text-xs font-semibold text-warmgray-600 cursor-pointer">
                  エラー詳細
                </summary>
                <pre className="mt-2 text-[11px] text-warmgray-500 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                </pre>
              </details>
            )}

            <div className="flex gap-3 justify-center pt-2">
              <button onClick={this.handleReload} className="btn-primary">
                リロード
              </button>
              <button onClick={this.handleGoHome} className="btn-outline">
                ホームへ戻る
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
