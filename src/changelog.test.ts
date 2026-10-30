// Tests für die Versionsanzeige (versionLabel) und die Pflichtangaben zur aktuellen Version.

import { describe, expect, it } from "vitest";
import { CHANGELOGS, LATEST_VERSION, versionLabel } from "./changelog";
import pkg from "../package.json";

describe("versionLabel", () => {
  it("Datumsversionen als Beta, Nachtrag nur wenn > 0", () => {
    expect(versionLabel("26.11.0")).toBe("Beta 26.11");
    expect(versionLabel("26.11.2")).toBe("Beta 26.11.2");
    expect(versionLabel("27.1.0")).toBe("Beta 27.1");
  });

  it("alte 0.x-Versionen bleiben Alpha", () => {
    expect(versionLabel("0.8.3")).toBe("Alpha 0.8.3");
    expect(versionLabel("0.8")).toBe("Alpha 0.8");
  });

  it("aktuelle Version hat einen Changelog-Eintrag und stimmt mit package.json überein", () => {
    expect(CHANGELOGS[LATEST_VERSION]).toBeDefined();
    expect(pkg.version).toBe(LATEST_VERSION);
  });
});
