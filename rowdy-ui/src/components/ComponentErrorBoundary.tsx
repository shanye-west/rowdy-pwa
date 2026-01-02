import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  /** Fallback UI to show on error. Can be a ReactNode or render function. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
  /** Optional callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Component-level error boundary for gracefully handling errors in subtrees.
 * Use this to wrap components that might throw (e.g., data visualization, stats).
 * 
 * Usage:
 * <ComponentErrorBoundary fallback={<div>Stats unavailable</div>}>
 *   <PostMatchStats {...props} />
 * </ComponentErrorBoundary>
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ComponentErrorBoundary caught error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      const { error } = this.state;
      
      // If fallback is a function, call it with the error
      if (typeof fallback === "function" && error) {
        return fallback(error) as ReactNode;
      }
      
      // If fallback is provided as ReactNode, use it
      if (fallback) {
        return fallback as ReactNode;
      }
      
      // Default fallback
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
          <p className="text-red-700 text-sm font-medium">Something went wrong</p>
          <p className="text-red-500 text-xs mt-1">This section couldn't load</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ComponentErrorBoundary;
