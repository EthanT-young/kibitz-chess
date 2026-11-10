import { Component, type ReactNode } from 'react';

/** Catches render errors (e.g. from corrupted saved data) and offers a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  private clearSaved = () => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('kibitz.')) localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>Kibitz hit an error it couldn’t recover from. Reloading usually fixes it. If it keeps happening, your saved reviews or settings may be damaged; clearing them starts fresh.</p>
        <div className="row gap">
          <button className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button className="btn secondary" onClick={this.clearSaved}>
            Clear saved reviews and settings
          </button>
        </div>
      </div>
    );
  }
}
