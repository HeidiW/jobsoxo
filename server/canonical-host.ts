// One public address. Pay links, OAuth callbacks and emails are all built
// from APP_URL, so a request arriving on any other host (the onrender.com
// subdomain, www.) is sent to the canonical one with a permanent redirect.
// Webhooks are left alone: a provider still configured with the old host
// must keep working until it's updated.
import type { NextFunction, Request, RequestHandler, Response } from "express";

const WEBHOOK_PREFIXES = ["/api/webhooks/", "/api/gusto/webhook", "/api/sms/inbound"];

export function canonicalHostFor(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    return url.protocol === "https:" ? url.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function requestHost(req: Request): string {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim() || req.headers.host || "";
  return raw.toLowerCase();
}

export function shouldRedirect(host: string, canonical: string | null, path: string): boolean {
  if (!canonical || !host || host === canonical) return false;
  if (host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]")) return false;
  return !WEBHOOK_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function canonicalHostRedirect(appUrl: string | undefined = process.env.APP_URL): RequestHandler {
  const canonical = canonicalHostFor(appUrl);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!shouldRedirect(requestHost(req), canonical, req.path)) return next();
    res.redirect(301, `https://${canonical}${req.originalUrl}`);
  };
}
