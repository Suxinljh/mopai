import { authRouter } from "./auth-router";
import { storageRouter } from "./storage-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  storage: storageRouter,
});

export type AppRouter = typeof appRouter;
