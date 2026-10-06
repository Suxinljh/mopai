import { useState } from 'react'
import { useNavigate } from 'react-router'
import { trpc } from '@/providers/trpc'

export default function Login() {
  const [accessKey, setAccessKey] = useState('')
  const navigate = useNavigate()
  const utils = trpc.useUtils()

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (res) => {
      if (res.success) {
        await utils.auth.me.invalidate()
        navigate('/')
      }
    },
  })

  const rejected = loginMutation.data && !loginMutation.data.success

  return (
    <div className="ya-page flex min-h-screen items-center justify-center">
      <div className="ya-card w-full max-w-sm p-6">
        <div className="mb-5 flex flex-col items-center gap-1 text-center">
          {/* 灯与夜：brand mark */}
          <span className="relative mb-2 inline-flex h-6 w-8" aria-hidden>
            <span className="absolute bottom-0 left-0 h-6 w-6 rounded-full bg-[#4F6CE8]/85" />
            <span className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full bg-[#F06A20]" />
          </span>
          <span className="text-xl font-bold tracking-wide text-[#0E1525]">墨排</span>
          <span className="ya-eyebrow">wechat md studio</span>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (accessKey) loginMutation.mutate({ accessKey })
          }}
        >
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="访问口令"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            className="ya-input w-full"
            style={rejected ? { boxShadow: 'inset 3px 3px 6px rgba(143,158,191,0.40), inset -2px -2px 5px rgba(255,255,255,0.95), 0 0 0 2px var(--error-500)' } : undefined}
          />
          <button className="ya-btn ya-btn-primary w-full !h-10" type="submit" disabled={!accessKey || loginMutation.isPending}>
            {loginMutation.isPending ? '验证中…' : '进入'}
          </button>
        </form>
        {rejected && (
          <p className="mt-3 text-center text-[12px] text-[#A23F3F]">{loginMutation.data?.message}</p>
        )}
        <p className="mt-4 text-center text-[12px] leading-relaxed text-[#6B7793]">
          只有上传图片需要口令；编辑、排版、复制和导出都可以直接使用。
        </p>
      </div>
    </div>
  )
}
