import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What to show instead. Defaults to a full-screen message with a reload button. */
  fallback?: ReactNode;
}

/** Keeps one broken panel from blanking the whole monitor. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="crash glass" role="alert">
        <h2>Something went wrong</h2>
        <p>The display hit an error. Capture keeps running in the background.</p>
        <code>{this.state.error.message}</code>
        <button className="btn btn-primary" onClick={() => location.reload()}>Reload the display</button>
      </div>
    );
  }
}
