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
  it("unquotierte url(…) mit Klammern lässt «}» nicht aus dem Bereich ausbrechen", () => {
    // der Browser liest «url(x{)» als ein Token: das zweite «}» schlösse sonst den @scope-Block
    expect(cssBalanced("p{background:url(x{)}} body{display:none} p{}")).toBe(false);
    expect(cssBalanced("p{background:u\\72l(x{)}} body{display:none} p{}")).toBe(false);
    expect(cssBalanced("p{background:URL( x{ )}} body{display:none} p{}")).toBe(false);
    expect(cssBalanced("p{background:url(x{")).toBe(false);
    // gewöhnliche Verwendung bleibt gültig
    expect(cssBalanced("p{background:url(data:image/png;base64,AAA=) no-repeat}")).toBe(true);
    expect(cssBalanced('p{background:url("a}b")}')).toBe(true);
    expect(cssBalanced("p{background:url( 'a{b' )}")).toBe(true);
    expect(cssBalanced(".a{ b: curl(c) } .d{}")).toBe(true);
  });
});
