import { describe, expect, it } from "vitest";
import {
  hasWorksheetAccess, isRouteActive, legacyInboxDestination,
} from "@/lib/app-shell";
import { APP_PRIMARY_NAV_ITEMS } from "@/components/app-sidebar";

describe("JobsOxo shell navigation", () => {
  it("keeps the nine primary destinations in the agreed order", () => {
    expect(APP_PRIMARY_NAV_ITEMS).toEqual([
      "Dashboard", "Clients", "Jobs", "Materials", "Invoices", "Change Orders",
      "Scheduling", "Payroll", "Inbox",
    ]);
  });

  it("matches nested sections only on their route boundary", () => {
    expect(isRouteActive("/jobs/123/line-items", "/jobs")).toBe(true);
    expect(isRouteActive("/invoices/new", "/invoices")).toBe(true);
    expect(isRouteActive("/jobs-archive", "/jobs")).toBe(false);
    expect(isRouteActive("/", "/")).toBe(true);
    expect(isRouteActive("/clients", "/")).toBe(false);
  });

  it("redirects legacy inbox URLs while retaining every callback/query parameter", () => {
    expect(legacyInboxDestination(
      "/gmail-todos",
      "?gmail_connected=1&state=csrf-token&returnTo=%2Fgmail-todos&custom=a%20b",
    )).toBe("/inbox?gmail_connected=1&state=csrf-token&returnTo=%2Fgmail-todos&custom=a+b&view=gmail");
    expect(legacyInboxDestination("/gmail-todos", "?gmail_error=access_denied&state=csrf-token"))
      .toBe("/inbox?gmail_error=access_denied&state=csrf-token&view=gmail");
    expect(legacyInboxDestination("/inbox-tasks", "?filter=open")).toBe("/inbox?filter=open&view=business");
  });

  it("limits the worksheet tab to admin accounts", () => {
    expect(hasWorksheetAccess(true)).toBe(true);
    expect(hasWorksheetAccess(false)).toBe(false);
  });
});
