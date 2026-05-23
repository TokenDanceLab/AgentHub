import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] render error:', error, info);
  }

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
        >
          Something went wrong
        </div>
      );
    }
    return this.props.children;
  }
}
