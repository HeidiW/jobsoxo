import { describe, expect, it } from "vitest";
import { invoicesToCsv } from "../invoices-export";

describe("Invoice CSV export", () => {
  it("exports the visible invoice fields without rounding off cents", () => {
    const csv = invoicesToCsv([{
      invoiceNumber: "JOX-100", client: "Northline", job: "Hotel restoration",
      issued: "Oct 1, 2026", due: "Nov 30, 2026", status: "partial",
      total: "1500.57", balance: "500.25",
    }]);
    expect(csv.split("\r\n")).toEqual([
      '"Invoice","Client","Job","Issued","Due","Status","Total","Balance"',
      '"JOX-100","Northline","Hotel restoration","Oct 1, 2026","Nov 30, 2026","partial","1500.57","500.25"',
    ]);
  });

  it("escapes quotes, commas and line breaks and handles missing optional fields", () => {
    const csv = invoicesToCsv([{
      invoiceNumber: "JOX-101", client: 'A "quoted", company', job: "First floor\nSecond floor",
      total: 0, balance: null,
    }]);
    expect(csv).toContain('"A ""quoted"", company"');
    expect(csv).toContain('"First floor\nSecond floor"');
    expect(csv).toContain('"0",""');
    expect(csv).not.toContain("undefined");
    expect(csv).not.toContain("null");
  });

  it("prevents spreadsheet formulas in user-entered text, including leading whitespace", () => {
    for (const text of ['=HYPERLINK("https://example.com")', "+1+2", "-1+2", "@SUM(1)", " \t=1+1"]) {
      const csv = invoicesToCsv([{ client: text }]);
      expect(csv).toContain(`"'${text.replaceAll('"', '""')}"`);
    }
    expect(invoicesToCsv([{ client: "JOX-100" }])).toContain('"JOX-100"');
  });

  it("returns only headers when there are no matching invoices", () => {
    expect(invoicesToCsv([]).split("\r\n")).toHaveLength(1);
  });
});
