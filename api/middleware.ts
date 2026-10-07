import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { newVisitorId, readVisitorId, visitorCookie, visitorKey } from "./lib/visitor";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

/**
 * Uploads are open to everyone now, but "whose picture is this" still has to be
 * answerable — without an identity every visitor would see, and be able to
 * delete, everybody else's images. So each caller carries a visitor key: the
 * hash of a first-party cookie, minted on first contact.
 */
const withVisitor = t.middleware(async ({ ctx, next }) => {
  const existing = readVisitorId(ctx.req.headers);
  if (existing) return next({ ctx: { ...ctx, visitor: visitorKey(existing) } });

  const id = newVisitorId();
  ctx.resHeaders.append("set-cookie", visitorCookie(id, ctx.req.headers));
  return next({ ctx: { ...ctx, visitor: visitorKey(id) } });
});

export const visitorQuery = t.procedure.use(withVisitor);

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));
