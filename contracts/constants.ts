export const Session = {
  cookieName: "mopai_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "需要登录后才能上传图片",
  insufficientRole: "权限不足",
} as const;
