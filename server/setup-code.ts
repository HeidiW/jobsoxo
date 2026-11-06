import { createHash, timingSafeEqual } from "crypto";

// First-time setup creates the admin account on an empty database. On a public
// deploy, whoever reaches it first would become admin, so it requires the
// SETUP_CODE environment variable. Production without SETUP_CODE refuses setup
// entirely; local development and tests need no code.

export function setupCodeRequired(): boolean {
  return !!process.env.SETUP_CODE || process.env.NODE_ENV === "production";
}

export type SetupCodeCheck = "ok" | "not_configured" | "invalid";

export function checkSetupCode(provided: unknown): SetupCodeCheck {
  const expected = process.env.SETUP_CODE;
  if (!expected) return process.env.NODE_ENV === "production" ? "not_configured" : "ok";
  if (typeof provided !== "string") return "invalid";
  // Hash both so the comparison is constant-time regardless of length.
  const digest = (value: string) => createHash("sha256").update(value.trim()).digest();
  return timingSafeEqual(digest(provided), digest(expected)) ? "ok" : "invalid";
}
