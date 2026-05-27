import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import { db } from "./db";
import { oauthAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import crypto from "crypto";

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

export async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  email: string | null,
  displayName: string | null,
) {
  const [existing] = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerId, providerId)));

  if (existing) {
    return storage.getUser(existing.userId);
  }

  let user = email ? await storage.getUserByEmail(email) : null;

  if (!user) {
    const base =
      (email
        ? email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 20)
        : null) ||
      displayName?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 20) ||
      "user";

    let username = base;
    let attempt = 0;
    while (await storage.getUserByUsername(username)) {
      attempt++;
      username = `${base}${attempt}`;
    }

    const randomPass = crypto.randomBytes(32).toString("hex");
    const hash = await bcrypt.hash(randomPass, 10);
    user = await storage.createUser({
      username,
      password: hash,
      email: email ?? undefined,
    });
  }

  await db.insert(oauthAccounts).values({
    userId: user!.id,
    provider,
    providerId,
    email: email ?? null,
  });

  return user!;
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
            const user = await findOrCreateOAuthUser(
              "google",
              profile.id,
              email,
              profile.displayName,
            );
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
            const user = await findOrCreateOAuthUser(
              "microsoft",
              profile.id,
              email,
              profile.displayName,
            );
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
            const user = await findOrCreateOAuthUser("apple", sub, email, null);
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
              const user = await findOrCreateOAuthUser(
                "yahoo",
                payload.sub,
                payload.email ?? null,
                payload.name ?? null,
              );
              return done(null, user ?? false);
            }
            const resp = await fetch(
              "https://api.login.yahoo.com/openid/v1/userinfo",
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            const info = (await resp.json()) as any;
            const user = await findOrCreateOAuthUser(
              "yahoo",
              info.sub,
              info.email ?? null,
              info.name ?? null,
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
