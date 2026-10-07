import { useState } from 'react'
import { useNavigate } from 'react-router'
import { trpc } from '@/providers/trpc'
import { APP_NAME, APP_BYLINE } from '@/lib/brand'
import { YoruMark } from '@/components/YoruMark'

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
          <span className="mb-2.5">
            <YoruMark size={52} />
          </span>
          <span className="text-[19px] font-bold tracking-wide text-[#0E1525]">{APP_NAME}</span>
          <span className="ya-eyebrow">{APP_BYLINE}</span>
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
