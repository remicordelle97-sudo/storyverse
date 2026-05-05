import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Top-level error boundary. Catches render-time exceptions in any
 * route so the user sees a recovery UI instead of a blank screen, and
 * the actual stack reaches the browser console for diagnosis. The
 * details block also surfaces error.stack + componentStack inline so
 * users pasting feedback can capture both without opening DevTools.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Render error caught by ErrorBoundary:", error, info);
    this.setState({ info });
  }

  componentDidUpdate(prevProps: Readonly<Props>) {
    if (
      this.state.error &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null, info: null });
    }
  }

  render() {
    if (this.state.error) {
      const { error, info } = this.state;
      return (
        <div
          className="min-h-screen flex items-center justify-center px-6 py-10"
          style={{ fontFamily: "Lexend, sans-serif" }}
        >
          <div className="max-w-2xl w-full text-center space-y-4">
            <h1 className="text-2xl font-bold text-stone-900">
              Something went wrong
            </h1>
            <p className="text-sm text-stone-600">
              The page hit an unexpected error. Try again, or refresh the page.
            </p>
            <details
              open
              className="text-left bg-stone-100 border border-stone-200 rounded-lg p-3 text-xs text-stone-600"
            >
              <summary className="cursor-pointer text-stone-700 font-medium">
                Error details
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                    Message
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-mono">
                    {error.message}
                  </pre>
                </div>
                {error.stack && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                      Stack
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10px] max-h-60 overflow-auto">
                      {error.stack}
                    </pre>
                  </div>
                )}
                {info?.componentStack && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                      Component stack
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10px] max-h-60 overflow-auto">
                      {info.componentStack}
                    </pre>
                  </div>
                )}
              </div>
            </details>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ error: null, info: null })}
                className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 text-sm font-medium transition-colors"
              >
                Refresh page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
