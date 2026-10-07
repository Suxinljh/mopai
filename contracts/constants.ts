export const Session = {
  cookieName: "mopai_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "需要登录后才能使用云端草稿箱",
  insufficientRole: "权限不足",
} as const;
