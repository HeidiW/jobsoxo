import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Google Analytics wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("initializes GA4 once and sends event data", async () => {
    const gtag = vi.fn();
    const appendChild = vi.fn();
    const script = { async: false, src: "", dataset: {} };

    vi.stubGlobal("window", { dataLayer: [], gtag });
    vi.stubGlobal("document", {
      querySelector: vi.fn().mockReturnValue(null),
      createElement: vi.fn().mockReturnValue(script),
      head: { appendChild },
    });

    const { initializeAnalytics, trackEvent } = await import("./analytics");
    initializeAnalytics();
    initializeAnalytics();
    trackEvent("invoice_created", {
      delivery: "draft",
      import_source: "google_doc",
      item_count: 3,
    });

    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(script.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    expect(gtag).toHaveBeenCalledWith("config", "G-TEST123", { anonymize_ip: true });
    expect(gtag).toHaveBeenCalledWith("event", "invoice_created", {
      delivery: "draft",
      import_source: "google_doc",
      item_count: 3,
    });
  });

  it("never throws when the analytics runtime fails", async () => {
    vi.stubGlobal("window", { dataLayer: [] });
    vi.stubGlobal("document", {
      querySelector: () => {
        throw new Error("blocked by browser");
      },
    });

    const { initializeAnalytics, trackEvent } = await import("./analytics");
    expect(() => initializeAnalytics()).not.toThrow();
    expect(() => trackEvent("job_saved", { action: "created" })).not.toThrow();
  });
});