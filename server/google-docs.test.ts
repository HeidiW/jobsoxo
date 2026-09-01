import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_URL = "https://example.test";
  process.env.GOOGLE_CLIENT_ID = "docs-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "docs-client-secret";
});

import {
  buildGoogleDocsAuthUrl,
  extractGoogleDocText,
  parseGoogleDocText,
} from "./google-docs";

function paragraph(text: string) {
  return {
    paragraph: {
      elements: [{ textRun: { content: `${text}\n` } }],
    },
  };
}

function cell(text: string) {
  return { content: [paragraph(text)] };
}

describe("Google Docs read-only OAuth", () => {
  it("requests only read-only Docs, Drive metadata, and email scopes", () => {
    const authUrl = new URL(buildGoogleDocsAuthUrl("csrf-state"));
    const scopes = new Set((authUrl.searchParams.get("scope") ?? "").split(" "));

    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("state")).toBe("csrf-state");
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("prompt")).toBe("select_account consent");
    expect(scopes).toEqual(new Set([
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ]));
    expect([...scopes].every((scope) => scope.endsWith(".readonly") || scope.endsWith("userinfo.email")))
      .toBe(true);
  });
});

describe("Google Doc invoice extraction", () => {
  it("preserves paragraph order and converts tables into tab-delimited rows", () => {
    const text = extractGoogleDocText({
      body: {
        content: [
          paragraph("Invoice estimate"),
          {
            table: {
              tableRows: [
                { tableCells: [cell("Description"), cell("Qty"), cell("Rate"), cell("Amount")] },
                { tableCells: [cell("Interior painting"), cell("2"), cell("$450"), cell("$900")] },
              ],
            },
          },
          paragraph("Tax: 8%"),
        ],
      },
    });

    expect(text).toContain("Invoice estimate");
    expect(text).toContain("Description\tQty\tRate\tAmount");
    expect(text).toContain("Interior painting\t2\t$450\t$900");
    expect(text).toContain("Tax: 8%");
  });

  it("parses recognizable Google Doc table data without modifying the source", () => {
    const result = parseGoogleDocText([
      "Invoice estimate",
      "Description\tQty\tRate\tAmount",
      "Interior painting\t2\t$450\t$900",
      "Tax: 8%",
      "Due date: 09/30/2026",
    ].join("\n"));

    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]).toMatchObject({
      description: "Interior painting",
      amount: 900,
      category: "labor",
    });
    expect(result.taxRate).toBe(8);
    expect(result.dueDate).toBe("2026-09-30");
  });

  it("returns no items for empty or malformed content", () => {
    expect(parseGoogleDocText("This document has no priced line items.").lineItems).toEqual([]);
  });
});