import { describe, it, expect, afterEach, vi } from "vitest";
import { fromHeader, senderAddress, sendPasswordResetEmail } from "./email";

const original = process.env.EMAIL_FROM;

afterEach(() => {
  if (original === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = original;
  vi.unstubAllGlobals();
});

describe("EMAIL_FROM sender", () => {
  it("falls back to Resend's test sender when unset", () => {
    delete process.env.EMAIL_FROM;
    expect(senderAddress()).toBe("noreply@resend.dev");
    expect(fromHeader("Acme Painting")).toBe("Acme Painting <noreply@resend.dev>");
  });

  it("uses the configured address, bare or with a display name", () => {
    process.env.EMAIL_FROM = " noreply@jobsoxo.com ";
    expect(fromHeader("Acme Painting")).toBe("Acme Painting <noreply@jobsoxo.com>");

    process.env.EMAIL_FROM = "JobsOxo <hello@send.jobsoxo.com>";
    expect(fromHeader("Acme Painting")).toBe("Acme Painting <hello@send.jobsoxo.com>");
  });

  it("strips characters that would break the From header", () => {
    process.env.EMAIL_FROM = "noreply@jobsoxo.com";
    expect(fromHeader('Bad "Name" <x>\r\n')).toBe("Bad Name x <noreply@jobsoxo.com>");
    expect(fromHeader("  ")).toBe("JobsOxo <noreply@jobsoxo.com>");
  });

  it("sends password resets from the configured address", async () => {
    process.env.EMAIL_FROM = "noreply@jobsoxo.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPasswordResetEmail("heidi@jobsoxo.com", "heidi@jobsoxo.com", "https://jobsoxo.onrender.com/reset-password?token=t", { apiKey: "re_test", provider: "resend" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body).from).toBe("JobsOxo <noreply@jobsoxo.com>");
  });
});
