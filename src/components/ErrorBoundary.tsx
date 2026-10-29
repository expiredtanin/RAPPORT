// Fängt Render-Fehler einer Ansicht ab, damit nicht die ganze App weiss wird.
//
// Um die Ansichten in App.tsx (mit `resetKey` = aktuelle Ansicht, damit ein Wechsel den Fehler
// zurücksetzt) und einmal ganz aussen in main.tsx (letzte Linie, ohne App-Layout). Die Daten
// bleiben unberührt: gespeichert wird weiter über den Adapter, der Fehler betrifft nur die Anzeige.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Ändert sich der Wert (z.B. andere Ansicht), wird der Fehlerzustand verworfen und neu gerendert. */
  resetKey?: unknown;
  /** Ganz aussen: eigener Vollbild-Hintergrund, Knopf lädt die App neu statt nur die Ansicht. */
  fullscreen?: boolean;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/** Zeigt statt einer abgestürzten Ansicht eine Meldung mit «Erneut versuchen» und den Fehlertext. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ansicht abgestürzt:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fullscreen } = this.props;
    const retry = () => (fullscreen ? window.location.reload() : this.setState({ error: null }));
    return (
      <div style={fullscreen
        ? { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg, #ebe7e1)", padding: 24, fontFamily: "'Inter', sans-serif" }
        : { padding: "40px 0", display: "flex", justifyContent: "center" }}>
        <div role="alert" className="card" style={{ maxWidth: 520, padding: "28px 30px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Diese Ansicht konnte nicht angezeigt werden</div>
          <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.7, marginBottom: 14 }}>
            Ein Fehler in der Anzeige ist aufgetreten. Ihre Daten sind davon nicht betroffen — gespeichert ist, was bis jetzt eingegeben wurde.
            Bleibt der Fehler, bitte den Text unten an den Support schicken.
          </div>
          <pre style={{ fontSize: 11, color: "var(--text4)", background: "var(--surface2)", borderRadius: 6, padding: "8px 10px",
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflow: "auto", marginBottom: 18 }}>
            {error.message || String(error)}
          </pre>
          <button className="btn btn-primary" onClick={retry}>{fullscreen ? "App neu laden" : "Erneut versuchen"}</button>
        </div>
      </div>
    );
  }
}
