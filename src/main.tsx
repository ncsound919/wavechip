import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#080f22] text-slate-100 flex items-center justify-center p-6 font-mono">
          <div className="max-w-lg w-full border border-[#d98cb3] rounded-md bg-[#0a1228] p-5 space-y-3">
            <h1 className="text-sm font-bold text-[#f2b5d4]">WaveChip Render Recovery</h1>
            <p className="text-xs text-[#5eead4] break-words">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-3 py-1.5 rounded bg-[#132044] border border-[#2dd4bf] text-xs text-[#5eead4] cursor-pointer"
            >
              Reload UI
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
