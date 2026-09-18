import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/lib/auth'
import { getActiveOrganization, getCurrentUserId } from '@/server/auth/session'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'

/**
 * ログイン画面(デザイン 画面01)。Googleログインのみ。
 * 招待されていないアカウントで試みた場合の拒否表示も含む。
 */

type Message = { title: string; body: string; offerSignOut?: boolean }

const MESSAGES: Record<string, Message> = {
  'not-invited': {
    title: 'このアカウントは招待されていません',
    body:
      'Seggr は招待されたメールアドレスでのみ利用できます。別のGoogleアカウントでログインするか、招待した本人にご確認ください。',
  },
  'invitation-expired': {
    title: '招待の有効期限が切れています',
    body: '招待した本人に、招待の再発行を依頼してください。',
  },
  'email-unverified': {
    title: 'メールアドレスが確認されていません',
    body:
      'Googleアカウントのメールアドレスが未確認の状態です。Google側で確認を済ませてから、もう一度お試しください。',
  },
  'no-email': {
    title: 'メールアドレスを取得できませんでした',
    body: 'Googleアカウントのメールアドレスへのアクセスを許可してから、もう一度お試しください。',
  },
  'no-organization': {
    title: '所属する組織が見つかりません',
    body: '招待が取り消された可能性があります。招待した本人にご確認ください。',
    offerSignOut: true,
  },
  'unsupported-provider': {
    title: 'このログイン方法には対応していません',
    body: 'Googleアカウントでログインしてください。',
  },
  OAuthAccountNotLinked: {
    title: 'このメールアドレスは別のログイン方法に紐づいています',
    body:
      'Googleアカウントを作り直した場合に起きます。招待した本人に連絡して、連携の解除を依頼してください。',
    offerSignOut: true,
  },
  Configuration: {
    title: 'ログインの設定が未完了です',
    body:
      'AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET が設定されているか確認してください(README 参照)。',
  },
}

const FALLBACK: Message = {
  title: 'ログインできませんでした',
  body: 'もう一度お試しください。解決しない場合は招待した本人にご確認ください。',
  offerSignOut: true,
}

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 16 では searchParams は Promise
  searchParams: Promise<{ error?: string }>
}) {
  const [{ error }, userId, active] = await Promise.all([
    searchParams,
    getCurrentUserId(),
    getActiveOrganization(),
  ])

  // ログイン済みで組織もあるなら、ここに留まる理由がない
  if (userId && active) redirect('/')

  const message = error ? (MESSAGES[error] ?? FALLBACK) : null

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-7)',
          padding: 'var(--space-8)',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 600 }}>Seggr</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            見積・契約・請求を1つにまとめる書類管理ツール
          </p>
        </div>

        {message && (
          <Notice tone="danger" title={message.title}>
            {message.body}
          </Notice>
        )}

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <Button type="submit" variant="primary" style={{ width: '100%' }}>
            Googleでログイン
          </Button>
        </form>

        {/* ログイン済みなのに入れない状態から抜け出す導線。
            これが無いとセッションが残ったまま同じ画面に戻り続ける */}
        {userId && message?.offerSignOut && (
          <form
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <Button type="submit" variant="text" style={{ width: '100%' }}>
              別のアカウントでログインする(ログアウト)
            </Button>
          </form>
        )}

        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)' }}>
          招待されたメールアドレスのGoogleアカウントでのみログインできます。
        </p>
      </div>
    </main>
  )
}
