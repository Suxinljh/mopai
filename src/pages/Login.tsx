import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F9]">
      <Card className="w-full max-w-sm border-black/8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.06)]">
        <CardHeader className="text-center">
          <CardTitle className="flex flex-col items-center gap-1">
            <span className="text-xl font-bold tracking-wide text-[#111]">墨排</span>
            <span className="text-[10px] font-normal uppercase tracking-[0.18em] text-[#9A9A9A]">WeChat MD Studio</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (accessKey) loginMutation.mutate({ accessKey })
            }}
          >
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="访问口令"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
            <Button className="w-full" size="lg" type="submit" disabled={!accessKey || loginMutation.isPending}>
              {loginMutation.isPending ? '验证中…' : '进入'}
            </Button>
          </form>
          {rejected && (
            <p className="text-center text-[12px] text-[#D93F3F]">{loginMutation.data?.message}</p>
          )}
          <p className="text-center text-[12px] leading-relaxed text-[#9A9A9A]">
            只有上传图片需要口令；编辑、排版、复制和导出都可以直接使用。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
