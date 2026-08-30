import React from 'react';

import { useStrings } from '@/i18n/strings';

import { ErrorNotice } from './ErrorNotice';

interface Props {
  children: React.ReactNode;
  /**
   * Optional custom fallback renderer. Receives a retry callback that clears
   * the error state and re-renders children. Defaults to DefaultErrorFallback.
   */
  fallback?: (retry: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Localized default fallback for ErrorBoundary. Extracted as a function
 * component so it can use the useStrings hook (class components cannot).
 */
export function DefaultErrorFallback({ onRetry }: { onRetry: () => void }): React.ReactElement {
  const t = useStrings();
  return (
    <ErrorNotice
      title={t.errorBoundaryTitle}
      description={t.errorBoundaryDescription}
      onRetry={onRetry}
    />
  );
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
    // 错误边界仅做开发期诊断输出；用户可见错误由 fallback/ErrorNotice 呈现。
    // eslint-disable-next-line no-console -- 边界错误日志是受控用途，不属于 UI 噪音
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
      return <DefaultErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
