import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
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
  serve({ fetch: app.fetch, port }, () => {
    console.log(`墨排 running on http://localhost:${port}/`);
  });
}
