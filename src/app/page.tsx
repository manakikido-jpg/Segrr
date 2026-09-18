import { signOut } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireOrganization } from '@/server/auth/session'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table } from '@/components/ui/Table'

/**
 * 暫定のダッシュボード(B1の動作確認用)。
 * 本来のダッシュボード(デザイン 画面02)は C2 で作る。
 *
 * ここでは「ログインした人の組織に紐づくデータだけが見える」ことを確認できる形にしてある。
 */
export default async function Home() {
  // 組織スコープは必ずここから得る。リクエストから受け取らない
  const active = await requireOrganization()

  const customers = await db.customer.findMany({
    where: { organizationId: active.organizationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })

  return (
    <main style={{ padding: 'var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 600 }}>
            {active.organizationName}
          </h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            ロール: {active.role}
          </p>
        </div>
        <form
          action={async () => {
            'use server'
            await signOut({ redirectTo: '/login' })
          }}
        >
          <Button type="submit" variant="secondary">ログアウト</Button>
        </form>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>顧客</h2>
        {customers.length === 0 ? (
          <EmptyState
            title="顧客がまだありません"
            description="顧客管理画面はタスクB2で作ります。"
          />
        ) : (
          <Table>
            <thead><tr><th>顧客名</th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}><td>{c.name}</td></tr>
              ))}
            </tbody>
          </Table>
        )}
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)' }}>
          ここに出るのは {active.organizationName} の顧客だけです。別の組織のアカウントで
          ログインすると、別の一覧が表示されます。
        </p>
      </section>
    </main>
  )
}
