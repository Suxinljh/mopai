import type { CookieOptions } from "hono/utils/cookie";

/**
 * `Secure` is what a browser demands before it will store a cookie on https —
 * and also what makes it silently drop one delivered over plain http. So the
 * attribute has to follow the scheme the visitor actually used, not a guess made
 * from the host name.
 *
 * It used to be "secure unless the host is localhost/127.0.0.1", which is fine
 * for the upstream public-https deployment but breaks the moment the app is
 * reached by any other plain-http address: a NAS on the LAN
 * (http://192.168.1.20:3100) got Secure + SameSite=None, so login answered
 * success while the browser threw the session cookie away, and every following
 * request still looked anonymous.
 *
 * Behind a tunnel or reverse proxy the hop into the app is http even though the
 * visitor is on https, so x-forwarded-proto wins when it is present.
 */
function requestIsSecure(headers: Headers, url: string): boolean {
  const forwarded = headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase() === "https";
  return url.startsWith("https:");
}

export function getSessionCookieOptions(
  headers: Headers,
  url: string,
): CookieOptions {
  const secure = requestIsSecure(headers, url);

  return {
    httpOnly: true,
    path: "/",
    // SameSite=None is only honoured together with Secure, so plain http has to
    // fall back to Lax — which is all this app needs, since every request it
    // makes is same-site.
    sameSite: secure ? "None" : "Lax",
    secure,
  };
}
