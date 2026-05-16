import React from "react";
import { AuthProvider } from "./contexts/AuthContext";
import MainComponent from "./components/MainComponent";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error(err, info);
  }

  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#111",
            color: "#eee",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: 12 }}>SauceMate hit an error</h1>
          <p style={{ marginBottom: 16, color: "#aaa" }}>
            Open the browser console (F12 → Console) for details. Try a hard refresh or an
            incognito window.
          </p>
          <pre
            style={{
              fontSize: 13,
              overflow: "auto",
              padding: 12,
              background: "#000",
              borderRadius: 8,
              color: "#f88",
            }}
          >
            {String(this.state.err?.message || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <MainComponent />
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;
