import { authRouter } from "./auth-router";
import { docsRouter } from "./docs-router";
import { storageRouter } from "./storage-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  docs: docsRouter,
  storage: storageRouter,
});

export type AppRouter = typeof appRouter;
