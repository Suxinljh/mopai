import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { agentRouter } from "./agent-router";
import { createContext } from "./context";
import { storage } from "./lib/storage";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Public image read: stable address, redirects to the R2 worker.
// Copied WeChat HTML references this stable address, so the key space can never
// change; WeChat follows the redirect when it re-hosts the image.
app.get("/api/img/:key", async (c) => {
  const key = c.req.param("key");
  try {
    const { url } = await storage.getPresignedUrl({ key });
    return c.redirect(url, 302);
  } catch {
    return c.json({ error: "image not found" }, 404);
  }
});

// The agent door: REST + Bearer token, separate from the browser's tRPC session.
// If this app is ever put behind Cloudflare Access, this is the only prefix that
// may get a service-token bypass — /api/trpc/* carries auth.login and must stay
// behind the perimeter.
app.route("/api/agent", agentRouter);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3100");
  // Loopback by default: the only intended entry point is the Cloudflare Tunnel,
  // so the app must not be reachable by hitting the host's public IP directly.
  const hostname = process.env.HOST || "127.0.0.1";
  serve({ fetch: app.fetch, port, hostname }, () => {
    console.log(`公众号排版助手 running on http://${hostname}:${port}/`);
  });
}
