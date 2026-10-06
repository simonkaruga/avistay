import { Component, ReactNode } from "react";

import { AlertCircle } from "lucide-react";
interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-(--bg-primary)">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-(--text-primary) mb-1">Something went wrong</h2>
        <p className="text-sm text-(--text-muted) mb-6 max-w-xs">
          {this.state.error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #1f4d36 0%, #2a6446 100%)" }}
        >
          Reload page
        </button>
      </div>
    );
  }
}
