import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Changing this clears a caught error and re-renders the remote. */
  resetKey: number;
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: number;
}

/** Isolates one micro-frontend: its crash must never take down the shell or its siblings. */
export class RemoteBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[mfe-shell] micro-frontend crashed', error, info.componentStack);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
