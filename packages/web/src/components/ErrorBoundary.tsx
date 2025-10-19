import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
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
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="container mt-5">
          <div className="alert alert-danger" role="alert">
            <h1 className="alert-heading">Something went wrong</h1>
            <p>The application encountered an unexpected error. Please try refreshing the page.</p>
            {this.state.error && (
              <>
                <hr />
                <p className="mb-0">
                  <strong>Error details:</strong> {this.state.error.message}
                </p>
              </>
            )}
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
