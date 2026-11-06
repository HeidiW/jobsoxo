import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import { db } from "./db";
import { oauthAccounts, users } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { storage } from "./storage";

export type OAuthProvider = "google" | "microsoft" | "apple" | "yahoo";

export function getBaseUrl() {
  return (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
}

export function callbackUrl(provider: OAuthProvider) {
  return `${getBaseUrl()}/api/auth/${provider}/callback`;
}

export function getEnabledProviders(): Record<OAuthProvider, boolean> {
  return {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    apple: !!(
      process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY
    ),
    yahoo: !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET),
  };
}

/**
 * Signs in an existing JobsOxo user with a provider identity. Never creates
 * accounts: new people join by invite (or first-time setup), so a stranger's
 * Google/Yahoo login must not grant access to the business's data.
 *
 * Returns the user when the identity is already linked, or when the provider
 * has verified an email matching a user's email or email-style username (the
 * identity is then linked). Otherwise returns null.
 */
export async function findOAuthUser(
  provider: string,
  providerId: string,
  email: string | null,
  emailVerified: boolean,
) {
  const [existing] = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerId, providerId)));

  if (existing) {
    return (await storage.getUser(existing.userId)) ?? null;
  }

  // An unverified email could belong to anyone, so it can't claim an account.
  if (!email || !emailVerified) return null;

  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(sql`lower(${users.email})`, normalized), eq(sql`lower(${users.username})`, normalized)))
    .limit(1);
  if (!user) return null;

  await db.insert(oauthAccounts).values({
    userId: user.id,
    provider,
    providerId,
    email,
  });

  return user;
}

export function setupOAuthStrategies() {
  const enabled = getEnabledProviders();

  // ── Google ───────────────────────────────────────────────────────────────
  if (enabled.google) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          callbackURL: "/api/auth/google/callback",
          proxy: true,
        },
        async (_at, _rt, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value ?? null;
            const verified =
              (profile.emails?.[0] as { verified?: boolean } | undefined)?.verified === true ||
              (profile._json as { email_verified?: boolean } | undefined)?.email_verified === true;
            const user = await findOAuthUser("google", profile.id, email, verified);
            done(null, user ?? false);
          } catch (e) {
            done(e as Error);
          }
        },
      ),
    );
  }

  // ── Microsoft ────────────────────────────────────────────────────────────
  if (enabled.microsoft) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Strategy: MicrosoftStrategy } = require("passport-microsoft");
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: process.env.MICROSOFT_CLIENT_ID!,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
          callbackURL: "/api/auth/microsoft/callback",
          proxy: true,
          scope: ["user.read"],
          tenant: "common",
        },
        async (
          _at: string,
          _rt: string,
          profile: any,
          done: (err: any, user?: any) => void,
        ) => {
          try {
            const email =
              profile.emails?.[0]?.value ?? profile._json?.mail ?? null;
            // Microsoft doesn't reliably verify emails ("common" tenant), so
            // only an already-linked identity can sign in.
            const user = await findOAuthUser("microsoft", profile.id, email, false);
            done(null, user ?? false);
          } catch (e) {
            done(e as Error);
          }
        },
      ),
    );
  }

  // ── Apple ────────────────────────────────────────────────────────────────
  if (enabled.apple) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AppleStrategy = require("passport-apple");
    passport.use(
      new AppleStrategy(
        {
          clientID: process.env.APPLE_CLIENT_ID!,
          teamID: process.env.APPLE_TEAM_ID!,
          keyID: process.env.APPLE_KEY_ID!,
          privateKeyString: process.env.APPLE_PRIVATE_KEY!,
          callbackURL: "/api/auth/apple/callback",
          proxy: true,
          scope: ["name", "email"],
        },
        async (
          _at: string,
          _rt: string,
          idToken: any,
          _profile: any,
          done: (err: any, user?: any) => void,
        ) => {
          try {
            const sub = idToken?.sub as string;
            const email = (idToken?.email as string) ?? null;
            const verified = idToken?.email_verified === true || idToken?.email_verified === "true";
            const user = await findOAuthUser("apple", sub, email, verified);
            done(null, user ?? false);
          } catch (e) {
            done(e as Error);
          }
        },
      ),
    );
  }

  // ── Yahoo ────────────────────────────────────────────────────────────────
  if (enabled.yahoo) {
    passport.use(
      "yahoo",
      new OAuth2Strategy(
        {
          authorizationURL: "https://api.login.yahoo.com/oauth2/request_auth",
          tokenURL: "https://api.login.yahoo.com/oauth2/get_token",
          clientID: process.env.YAHOO_CLIENT_ID!,
          clientSecret: process.env.YAHOO_CLIENT_SECRET!,
          callbackURL: "/api/auth/yahoo/callback",
          proxy: true,
          scope: "openid email profile",
        } as any,
        async (
          accessToken: string,
          _rt: string,
          params: any,
          _profile: any,
          done: (err: any, user?: any) => void,
        ) => {
          try {
            if (params?.id_token) {
              const payload = JSON.parse(
                Buffer.from(
                  params.id_token.split(".")[1],
                  "base64url",
                ).toString("utf8"),
              );
              const user = await findOAuthUser(
                "yahoo",
                payload.sub,
                payload.email ?? null,
                payload.email_verified === true,
              );
              return done(null, user ?? false);
            }
            const resp = await fetch(
              "https://api.login.yahoo.com/openid/v1/userinfo",
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            const info = (await resp.json()) as any;
            const user = await findOAuthUser(
              "yahoo",
              info.sub,
              info.email ?? null,
              info.email_verified === true,
            );
            done(null, user ?? false);
          } catch (e) {
            done(e as Error);
          }
        },
      ),
    );
  }
}

export { passport };
