import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render-time exceptions in any
 * route so the user sees a recovery UI instead of a blank screen, and
 * the actual stack reaches the browser console for diagnosis. Mounted
 * inside the AppRoutes shell so navigations after the error remount
 * naturally — i.e., clicking "Try again" replaces the error tree.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to the browser console — surfaces in Sentry / similar later
    // and is what a user pasting "white screen" feedback can grab.
    // eslint-disable-next-line no-console
    console.error("Render error caught by ErrorBoundary:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="min-h-screen flex items-center justify-center px-6"
          style={{ fontFamily: "Lexend, sans-serif" }}
        >
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold text-stone-900">
              Something went wrong
            </h1>
            <p className="text-sm text-stone-600">
              The page hit an unexpected error. Try again, or refresh the page.
            </p>
            <details className="text-left bg-stone-100 border border-stone-200 rounded-lg p-3 text-xs text-stone-600">
              <summary className="cursor-pointer text-stone-700 font-medium">
                Error details
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </details>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ error: null })}
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
