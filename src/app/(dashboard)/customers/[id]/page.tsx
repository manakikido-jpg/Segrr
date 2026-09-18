import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrganization } from '@/server/auth/session'
import { getCustomer } from '@/server/services/customer-service'
import { CustomerForm } from '../CustomerForm'
import { canWrite } from '@/server/auth/types'
import type { CustomerFormValues } from '@/server/validators/customer'
import { deleteCustomerAction, updateCustomerAction } from '../actions'
import { DeleteCustomer } from './DeleteCustomer'

/**
 * 顧客詳細・編集(デザイン 画面04)。
 *
 * タブ(案件/書類/メモ)はデザインにあるが、案件が B3、書類が B4 以降まで
 * 存在しないためここでは作らない。
 */
export default async function CustomerDetailPage({
  params,
}: {
  // Next.js 16 では params は Promise
  params: Promise<{ id: string }>
}) {
  const [active, { id }] = await Promise.all([requireOrganization(), params])
  const customer = await getCustomer(active, id)

  // 他組織の顧客を指していた場合もここに来る(getCustomer が組織で絞っているため)
  if (!customer) notFound()

  const defaultValues: CustomerFormValues = {
    name: customer.name,
    contactName: customer.contactName ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    postalCode: customer.postalCode ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
    invoiceRegistrationNumber: customer.invoiceRegistrationNumber ?? '',
    closingDay: customer.closingDay?.toString() ?? '',
    paymentMonthOffset: customer.paymentMonthOffset.toString(),
    paymentDay: customer.paymentDay?.toString() ?? '',
    withholdingDefault: customer.withholdingDefault,
    honorific: customer.honorific,
  }

  // id を束縛したうえでフォームへ渡す。id をフォームの隠しフィールドに入れないのは、
  // 書き換えられると他の顧客を更新できてしまうため
  const update = updateCustomerAction.bind(null, customer.id)
  const remove = deleteCustomerAction.bind(null, customer.id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
      <div>
        <Link href="/customers" style={{ color: 'var(--color-accent)', fontSize: 'var(--text-sm)' }}>
          ← 顧客一覧
        </Link>
        <h1 style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--text-2xl)', fontWeight: 600 }}>
          {customer.name}
        </h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          案件 {customer._count.projects}件
        </p>
      </div>

      <CustomerForm
        action={update}
        defaultValues={defaultValues}
        submitLabel="保存する"
        readOnly={!canWrite(active.role)}
      />

      <section
        style={{
          borderTop: '1px solid var(--color-divider)',
          paddingTop: 'var(--space-7)',
          maxWidth: 640,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>削除</h2>
        <DeleteCustomer
          action={remove}
          projectCount={customer._count.projects}
          customerName={customer.name}
          readOnly={!canWrite(active.role)}
        />
      </section>
    </div>
  )
}
