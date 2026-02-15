import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Static fallback UI (takes precedence over fallbackRender) */
  fallback?: ReactNode;
  /** Render function for custom fallback with error details and reset action */
  fallbackRender?: (props: { error: Error; resetErrorBoundary: () => void }) => ReactNode;
  /** When any key changes, the boundary auto-resets (useful for route changes) */
  resetKeys?: unknown[];
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && this.props.resetKeys) {
      const prevKeys = prevProps.resetKeys ?? [];
      const currKeys = this.props.resetKeys;
      const changed =
        currKeys.length !== prevKeys.length || currKeys.some((key, i) => key !== prevKeys[i]);
      if (changed) {
        this.handleReset();
      }
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      if (this.props.fallbackRender) {
        return this.props.fallbackRender({
          error: this.state.error,
          resetErrorBoundary: this.handleReset,
        });
      }

      // Default fallback (backward-compatible with original)
      return (
        <div className="container mt-12">
          <div className="alert alert-danger" role="alert">
            <h1 className="alert-heading">Something went wrong</h1>
            <p>The application encountered an unexpected error. Please try refreshing the page.</p>
            <hr />
            <p className="mb-0">
              <strong>Error details:</strong> {this.state.error.message}
            </p>
            <hr />
            <button className="btn btn-outline-danger" onClick={this.handleReset}>
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
