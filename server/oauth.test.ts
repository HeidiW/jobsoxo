import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { oauthAccounts, users } from "@shared/schema";
import { storage } from "./storage";
import { findOAuthUser } from "./oauth";

const userCount = async () => (await db.select().from(users)).length;

describe("findOAuthUser", () => {
  it("never creates an account for an unknown identity", async () => {
    const before = await userCount();

    const user = await findOAuthUser("google", "stranger-sub", "stranger@example.com", true);

    expect(user).toBeNull();
    expect(await userCount()).toBe(before);
    expect(await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerId, "stranger-sub"))).toHaveLength(0);
  });

  it("signs in an already-linked identity", async () => {
    const owner = await storage.createUser({ username: "linked-owner", password: "x" });
    await db.insert(oauthAccounts).values({ userId: owner.id, provider: "google", providerId: "linked-sub", email: null });

    const user = await findOAuthUser("google", "linked-sub", null, false);

    expect(user?.id).toBe(owner.id);
  });

  it("links a verified email that matches a user's email", async () => {
    const owner = await storage.createUser({ username: "owner-by-email", password: "x", email: "Owner@Example.com" });

    const user = await findOAuthUser("google", "email-sub", "owner@example.com", true);

    expect(user?.id).toBe(owner.id);
    const [link] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerId, "email-sub"));
    expect(link.userId).toBe(owner.id);
  });

  it("links a verified email that matches an email-style username", async () => {
    // First-time setup stores "Username or Email" as the username.
    const owner = await storage.createUser({ username: "heidi@example.com", password: "x" });

    const user = await findOAuthUser("yahoo", "username-sub", "HEIDI@example.com", true);

    expect(user?.id).toBe(owner.id);
  });

  it("does not let an unverified email claim an existing account", async () => {
    await storage.createUser({ username: "victim@example.com", password: "x", email: "victim@example.com" });

    const user = await findOAuthUser("microsoft", "attacker-sub", "victim@example.com", false);

    expect(user).toBeNull();
    expect(await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerId, "attacker-sub"))).toHaveLength(0);
  });
});
