// Fängt Render-Fehler einer Ansicht ab, damit nicht die ganze App weiss wird.
//
// Um die Ansichten in App.tsx (mit `resetKey` = aktuelle Ansicht, damit ein Wechsel den Fehler
// zurücksetzt) und einmal ganz aussen in main.tsx (letzte Linie, ohne App-Layout). «Fehlertext kopieren»
// legt Meldung, Stack, Ansicht und Version für den Support in die Zwischenablage. Die Daten
// bleiben unberührt: gespeichert wird weiter über den Adapter, der Fehler betrifft nur die Anzeige.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { LATEST_VERSION } from "../changelog";

interface Props {
  children: ReactNode;
  /** Ändert sich der Wert (z.B. andere Ansicht), wird der Fehlerzustand verworfen und neu gerendert. */
  resetKey?: unknown;
  /** Ganz aussen: eigener Vollbild-Hintergrund, Knopf lädt die App neu statt nur die Ansicht. */
  fullscreen?: boolean;
}

interface State {
  error: Error | null;
  /** Komponentenpfad aus React (für den Support-Text). */
  componentStack: string;
  resetKey: unknown;
  copied: boolean;
}

/** Zeigt statt einer abgestürzten Ansicht eine Meldung mit «Erneut versuchen» und den Fehlertext. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "", resetKey: this.props.resetKey, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, componentStack: "", copied: false, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ansicht abgestürzt:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack || "" });
  }

  /** Fehlertext samt Stack, Ansicht und Version für den Support in die Zwischenablage. */
  private copy = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const text = [
      `Rapport ${LATEST_VERSION} — ${new Date().toISOString()}`,
      `Ansicht: ${String(this.props.resetKey ?? "(ganze App)")}`,
      "",
      error.stack || `${error.name}: ${error.message}`,
      componentStack && `\nKomponenten:${componentStack}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      console.warn("Zwischenablage nicht verfügbar:", text);
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fullscreen } = this.props;
    const retry = () => (fullscreen ? window.location.reload() : this.setState({ error: null, componentStack: "", copied: false }));
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={retry}>{fullscreen ? "App neu laden" : "Erneut versuchen"}</button>
            <button className="btn btn-ghost" onClick={this.copy}>{this.state.copied ? "Kopiert" : "Fehlertext kopieren"}</button>
          </div>
        </div>
      </div>
    );
  }
}
