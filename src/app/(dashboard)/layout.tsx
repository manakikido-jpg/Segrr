import Link from 'next/link'
import { signOut } from '@/lib/auth'
import { requireOrganization } from '@/server/auth/session'
import { Button } from '@/components/ui/Button'

/**
 * ログイン後の共通レイアウト(サイドナビ)。
 *
 * ここで requireOrganization() を呼ぶことで、配下のページすべてが
 * 「ログイン済みかつ組織に所属している」前提で書ける。
 * ただし各ページ・サービス層でも必ず組織スコープを指定すること
 * (レイアウトでの確認は入口の防波堤であって、データの境界ではない)。
 */

const NAV = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/customers', label: '顧客' },
] as const

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const active = await requireOrganization()

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>
      <nav
        style={{
          width: 'var(--sidebar-w)',
          flexShrink: 0,
          background: 'var(--color-sidebar-bg)',
          borderRight: '1px solid var(--color-divider)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>{active.organizationName}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            {active.role}
          </div>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: 'block',
                  padding: 'var(--space-4) var(--space-5)',
                  borderRadius: 'var(--radius-control)',
                  color: 'var(--color-text)',
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <form
          style={{ marginTop: 'auto' }}
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/login' })
          }}
        >
          <Button type="submit" variant="text">ログアウト</Button>
        </form>
      </nav>

      <main style={{ flex: 1, minWidth: 0, padding: 'var(--space-8)' }}>{children}</main>
    </div>
  )
}
