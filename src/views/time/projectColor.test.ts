import { describe, expect, it } from "vitest";
import { projectColor } from "./projectColor";

describe("projectColor", () => {
  it("liefert für dieselbe Id immer dieselbe Farbe", () => {
    expect(projectColor("p-123")).toEqual(projectColor("p-123"));
  });
  it("streut verschiedene Ids auf mehrere Farben", () => {
    const set = new Set(Array.from({ length: 40 }, (_, i) => projectColor(`proj-${i}`).solid));
    expect(set.size).toBeGreaterThan(5);
  });
  it("Tint passt sich über color-mix an die Oberfläche an", () => {
    expect(projectColor("x").tint).toContain("var(--surface)");
  });
});
