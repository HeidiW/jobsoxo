import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_URL = "https://example.test";
  process.env.GOOGLE_CLIENT_ID = "docs-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "docs-client-secret";
});

import {
  buildGoogleDocsAuthUrl,
  extractGoogleDocText,
  exchangeGoogleDocsCode,
  getGoogleDocsCallbackUrl,
  getGoogleDocsPublicBaseUrl,
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
  it("normalizes the configured public URL before generating the callback URI", () => {
    const originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = " https://invoices.example.com/// ";

    expect(getGoogleDocsPublicBaseUrl()).toBe("https://invoices.example.com");
    expect(getGoogleDocsCallbackUrl()).toBe(
      "https://invoices.example.com/api/google-docs/callback",
    );

    process.env.APP_URL = originalAppUrl;
  });

  it("rejects a missing or invalid public URL with actionable configuration errors", () => {
    const originalAppUrl = process.env.APP_URL;

    delete process.env.APP_URL;
    expect(() => getGoogleDocsCallbackUrl()).toThrow("APP_URL is not configured");

    process.env.APP_URL = "not-a-public-url";
    expect(() => getGoogleDocsCallbackUrl()).toThrow("APP_URL is invalid");

    process.env.APP_URL = originalAppUrl;
  });

  it("uses the canonical callback URI in the authorization URL", () => {
    const authUrl = new URL(buildGoogleDocsAuthUrl("csrf-state"));
    const scopes = new Set((authUrl.searchParams.get("scope") ?? "").split(" "));

    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("state")).toBe("csrf-state");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "https://example.test/api/google-docs/callback",
    );
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

  it("uses the same canonical callback URI when exchanging an authorization code", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "docs-access", refresh_token: "docs-refresh" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ email: "docs@example.com" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await exchangeGoogleDocsCode("authorization-code");

    const tokenRequest = fetchMock.mock.calls[0];
    expect(tokenRequest[0]).toBe("https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(tokenRequest[1].body).get("redirect_uri")).toBe(
      getGoogleDocsCallbackUrl(),
    );
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