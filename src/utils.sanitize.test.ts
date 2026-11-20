// Tests für die Link-Prüfung der Rich-Text-Bereinigung (sanitizeHtml selbst braucht ein DOM und läuft hier nicht).
import { describe, expect, it } from "vitest";
import { isSafeUrl } from "./utils";

describe("isSafeUrl", () => {
  it("lässt normale Links zu", () => {
    for (const u of ["https://rapport.ch", "mailto:a@b.ch", "tel:+41441234567", "/relativ", "#anker"]) expect(isSafeUrl(u)).toBe(true);
  });
  it("blockiert Skript- und Daten-Schemas, auch mit Leer- und Steuerzeichen verschleiert", () => {
    for (const u of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd"]) {
      expect(isSafeUrl(u)).toBe(false);
    }
  });
});
