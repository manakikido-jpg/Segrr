import Link from 'next/link'
import { requireOrganization } from '@/server/auth/session'
import { canWrite } from '@/server/auth/types'
import { CustomerForm } from '../CustomerForm'
import { createCustomerAction } from '../actions'

export default async function NewCustomerPage() {
  const active = await requireOrganization()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
      <div>
        <Link href="/customers" style={{ color: 'var(--color-accent)', fontSize: 'var(--text-sm)' }}>
          ← 顧客一覧
        </Link>
        <h1 style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--text-2xl)', fontWeight: 600 }}>
          顧客を登録
        </h1>
      </div>
      <CustomerForm
        action={createCustomerAction}
        submitLabel="登録する"
        readOnly={!canWrite(active.role)}
      />
    </div>
  )
}
