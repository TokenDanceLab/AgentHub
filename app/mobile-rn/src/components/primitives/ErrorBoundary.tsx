import React from 'react';

import { ErrorNotice } from './ErrorNotice';

interface Props {
  children: React.ReactNode;
  /**
   * Optional custom fallback renderer. Receives a retry callback that clears
   * the error state and re-renders children. Defaults to ErrorNotice.
   */
  fallback?: (retry: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Simple error boundary for mobile surfaces. */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[mobile ErrorBoundary] render error:', error, info);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.handleRetry);
      }
      return (
        <ErrorNotice
          title="Something went wrong"
          description="An unexpected error occurred while rendering this section."
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
