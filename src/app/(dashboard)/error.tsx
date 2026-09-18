'use client'

import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'

/**
 * 想定外の例外の受け皿。
 *
 * 検証エラーや「案件があるので削除できない」のような**想定内の失敗は戻り値で返す**ので、
 * ここに来るのは本当に想定外のものだけ。本番ではメッセージが伏せられ digest だけになるため、
 * 利用者には一般的な案内を出し、開発時のみ内容を表示する。
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 640 }}>
      <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 600 }}>
        問題が発生しました
      </h1>
      <Notice
        tone="danger"
        title="処理を完了できませんでした"
        actions={<Button variant="secondary" onClick={reset}>やり直す</Button>}
      >
        {process.env.NODE_ENV === 'development'
          ? error.message
          : '時間をおいてもう一度お試しください。続く場合は、下の識別子を添えてご連絡ください。'}
        {error.digest && (
          <div style={{ marginTop: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
            {error.digest}
          </div>
        )}
      </Notice>
    </div>
  )
}
