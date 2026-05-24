import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] render error:', error, info);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            background: 'var(--card)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--foreground)',
            fontSize: 'var(--font-size-sm)',
            textAlign: 'center',
            border: '1px solid var(--border)',
          }}
          role="alert"
        >
          <p style={{ margin: '0 0 12px' }}>
            {this.state.error?.message ?? 'Something went wrong'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--card)',
              color: 'var(--foreground)',
              fontSize: 'var(--font-size-sm)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
