import Link from 'next/link'
import { requireOrganization } from '@/server/auth/session'
import { listCustomers, type CustomerSort } from '@/server/services/customer-service'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { Table } from '@/components/ui/Table'
import { formatDate } from '@/lib/format'

/**
 * 顧客一覧(デザイン 画面03)。
 *
 * 「未入金」の列はデザインにあるが、請求書が B6 まで存在しないためここでは出さない。
 */
export default async function CustomersPage({
  searchParams,
}: {
  // Next.js 16 では searchParams は Promise
  searchParams: Promise<{ q?: string; sort?: string }>
}) {
  const [active, params] = await Promise.all([requireOrganization(), searchParams])
  const query = params.q ?? ''
  const sort: CustomerSort = params.sort === 'updated' ? 'updated' : 'name'
  const customers = await listCustomers(active, { query, sort })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 600 }}>顧客</h1>
        <Link href="/customers/new"><Button variant="primary">顧客を登録</Button></Link>
      </header>

      {/* 検索と並び替えは GET で行う。URLに条件が残るので共有・再読み込みができる */}
      <form style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Input name="q" defaultValue={query} placeholder="顧客名・担当者名・メールで検索" aria-label="顧客を検索" />
        </div>
        <Select name="sort" defaultValue={sort} aria-label="並び替え" style={{ width: 160 }}>
          <option value="name">名前順</option>
          <option value="updated">更新が新しい順</option>
        </Select>
        <Button type="submit" variant="secondary">絞り込む</Button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title={query ? '該当する顧客がありません' : '顧客がまだありません'}
          description={query ? '検索条件を変えてお試しください。' : '最初の顧客を登録すると、案件・見積・契約・請求へ進めます。'}
          action={
            query
              ? <Link href="/customers"><Button variant="secondary">検索条件をクリア</Button></Link>
              : <Link href="/customers/new"><Button variant="primary">顧客を登録</Button></Link>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>顧客名</th>
              <th>担当者</th>
              <th>登録番号</th>
              <th className="sg-num">案件数</th>
              <th>最終更新</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/customers/${c.id}`} style={{ color: 'var(--color-accent)' }}>{c.name}</Link>
                </td>
                <td>{c.contactName ?? ''}</td>
                <td style={{ color: c.invoiceRegistrationNumber ? undefined : 'var(--color-text-subtle)' }}>
                  {c.invoiceRegistrationNumber ?? '未登録'}
                </td>
                <td className="sg-num">{c._count.projects}</td>
                <td>{formatDate(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
