import React, { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: React.ErrorInfo, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error boundary component to catch React rendering errors and display a fallback UI.
 * Prevents the entire app from crashing when a component throws an error.
 *
 * @example
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 *
 * @example With custom fallback
 * <ErrorBoundary fallback={(error, errorInfo, reset) => (
 *   <div>
 *     <h2>Something went wrong</h2>
 *     <details>
 *       <summary>Error details</summary>
 *       <pre>{error.message}</pre>
 *       <pre>{errorInfo.componentStack}</pre>
 *     </details>
 *     <button onClick={reset}>Try again</button>
 *   </div>
 * )}>
 *   <YourComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error details for debugging
    console.error("ErrorBoundary caught an error:", error);
    console.error("Component stack:", errorInfo.componentStack);

    // Store error info in state
    this.setState({ errorInfo });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Custom fallback UI
      if (this.props.fallback && this.state.errorInfo) {
        return this.props.fallback(this.state.error, this.state.errorInfo, this.reset);
      }

      // Default fallback UI
      return (
        <div
          style={{
            padding: "20px",
            margin: "20px",
            border: "2px solid #ff6b6b",
            borderRadius: "8px",
            backgroundColor: "#ffe0e0",
            color: "#000",
          }}
        >
          <h2 style={{ margin: "0 0 16px 0", color: "#c92a2a" }}>⚠️ Something went wrong</h2>
          <details style={{ marginBottom: "16px" }}>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: "bold",
                marginBottom: "8px",
              }}
            >
              Error details
            </summary>
            <pre
              style={{
                padding: "12px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "4px",
                overflow: "auto",
                fontSize: "12px",
                lineHeight: "1.5",
              }}
            >
              {this.state.error.message}
            </pre>
            {this.state.errorInfo?.componentStack && (
              <pre
                style={{
                  marginTop: "8px",
                  padding: "12px",
                  backgroundColor: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  overflow: "auto",
                  fontSize: "11px",
                  lineHeight: "1.4",
                  maxHeight: "200px",
                }}
              >
                {this.state.errorInfo.componentStack}
              </pre>
            )}
          </details>
          <button
            onClick={this.reset}
            style={{
              padding: "8px 16px",
              backgroundColor: "#4c6ef5",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = "#3b5bdb";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = "#4c6ef5";
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
