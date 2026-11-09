import { describe, expect, it } from "vitest";
import { invoicePrefixFromCompanyName, isDerivedInvoicePrefix } from "./invoice-prefix";

describe("invoicePrefixFromCompanyName", () => {
  it("uses the initials of the meaningful words", () => {
    expect(invoicePrefixFromCompanyName("Conor Foy Plaster")).toBe("CFP");
    expect(invoicePrefixFromCompanyName("Crystal Grove LLP")).toBe("CG");
    expect(invoicePrefixFromCompanyName("Northstar Finish Co.")).toBe("NF");
    expect(invoicePrefixFromCompanyName("Smith & Sons Painting, Inc.")).toBe("SSP");
    expect(invoicePrefixFromCompanyName("The Brush and Roller Company")).toBe("BR");
  });

  it("handles one-word and empty names", () => {
    expect(invoicePrefixFromCompanyName("Jobsoxo")).toBe("JOB");
    expect(invoicePrefixFromCompanyName("LLC")).toBe("LLC");
    expect(invoicePrefixFromCompanyName("")).toBe("INV");
    expect(invoicePrefixFromCompanyName(null)).toBe("INV");
  });

  it("caps at four initials", () => {
    expect(invoicePrefixFromCompanyName("Alpha Beta Gamma Delta Epsilon")).toBe("ABGD");
  });
});

describe("isDerivedInvoicePrefix", () => {
  it("treats blank, the generic default and name-derived prefixes as not hand-chosen", () => {
    expect(isDerivedInvoicePrefix("")).toBe(true);
    expect(isDerivedInvoicePrefix("INV")).toBe(true);
    expect(isDerivedInvoicePrefix("CFP", "Conor Foy Plaster")).toBe(true);
    expect(isDerivedInvoicePrefix("cfp", "Conor Foy Plaster")).toBe(true);
    expect(isDerivedInvoicePrefix("JBX", "Conor Foy Plaster")).toBe(false);
  });
});
