// Datei: docDesign.test.ts — eigenes CSS darf nicht aus dem @scope der Vorschau ausbrechen (Runde 32)
import { describe, it, expect } from "vitest";
import { cssBalanced } from "./docDesign";

describe("cssBalanced", () => {
  it("ausgeglichenes CSS", () => {
    expect(cssBalanced(".doc-heading { color: red !important; }")).toBe(true);
    expect(cssBalanced("@media print { .a { b: c } }")).toBe(true);
    expect(cssBalanced('.a::after { content: "}"; } /* } */')).toBe(true);
    // Review R33: «/*» im String, escapte Klammer, Zeilenfortsetzung im String
    expect(cssBalanced('a::before{content:"/*"} b{color:red} /* x */')).toBe(true);
    expect(cssBalanced(".a\\{b { color: red }")).toBe(true);
    expect(cssBalanced('.a { content: "ab\\\ncd" }')).toBe(true);
    expect(cssBalanced('.a { content: "\\"" }')).toBe(true);
  });
  it("überzählige oder fehlende Klammer, offener Kommentar/String", () => {
    expect(cssBalanced("} .card, aside { display:none !important } body{background:red} .x{")).toBe(false);
    expect(cssBalanced(".a { color: red")).toBe(false);
    expect(cssBalanced(".a { color: red } /* offen")).toBe(false);
    expect(cssBalanced('.a { content: "offen }')).toBe(false);
  });
});
