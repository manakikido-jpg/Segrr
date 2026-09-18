import Link from 'next/link'
import { requireOrganization } from '@/server/auth/session'
import { listCustomers } from '@/server/services/customer-service'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'

/**
 * 暫定のダッシュボード。本来のダッシュボード(デザイン 画面02)は C2 で作る。
 * いまは組織スコープが効いていることを確認できる最小限にとどめる。
 */
export default async function Home() {
  const active = await requireOrganization()
  const customers = await listCustomers(active)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
      <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 600 }}>ダッシュボード</h1>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-5)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>顧客</h2>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {customers.length}件
          </span>
          <Link href="/customers" style={{ color: 'var(--color-accent)', fontSize: 'var(--text-sm)' }}>
            一覧を見る
          </Link>
        </div>

        {customers.length === 0 && (
          <EmptyState
            title="顧客がまだありません"
            description="最初の顧客を登録すると、案件・見積・契約・請求へ進めます。"
            action={<Link href="/customers/new"><Button variant="primary">顧客を登録</Button></Link>}
          />
        )}
      </section>
    </div>
  )
}
