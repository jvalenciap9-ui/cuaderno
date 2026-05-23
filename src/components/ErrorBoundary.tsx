// @ts-nocheck
import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

export class ErrorBoundary extends Component<Props, { hasError: boolean; error: Error | null }> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50 px-4">
          <div className="w-20 h-20 bg-red-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-red-100">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-3xl font-black text-neutral-900 mb-4 text-center tracking-tight">
            Algo salió mal
          </h1>
          <p className="text-neutral-500 mb-8 text-center max-w-md font-medium leading-relaxed">
            Hubo un error inesperado. Puedes intentar recargar la página.
          </p>
          <div className="flex gap-4">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs"
            >
              <RefreshCw className="w-5 h-5" />
              Reintentar
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-3 bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-4 rounded-2xl font-black transition-all shadow-xl active:scale-95 uppercase tracking-widest text-xs"
            >
              Recargar App
            </button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-8 p-6 bg-neutral-900 text-red-300 rounded-3xl text-xs max-w-2xl w-full overflow-auto font-mono leading-relaxed">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
