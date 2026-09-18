'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input, Select } from '@/components/ui/Input'
import { Notice } from '@/components/ui/Notice'
import {
  DAY_OPTIONS,
  HONORIFICS,
  emptyCustomerFormValues,
  type CustomerFormValues,
} from '@/server/validators/customer'
import type { FormState } from './actions'

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  defaultValues?: CustomerFormValues
  submitLabel: string
  readOnly?: boolean
}

const PAYMENT_MONTHS = [
  { value: '0', label: '当月' },
  { value: '1', label: '翌月' },
  { value: '2', label: '翌々月' },
]

const dayLabel = (d: number) => (d === 31 ? '末日' : `${d}日`)

export function CustomerForm({
  action,
  defaultValues = emptyCustomerFormValues,
  submitLabel,
  readOnly,
}: Props) {
  const [state, formAction, pending] = useActionState(action, null)

  // 検証に失敗したときは送信された値を使う。React は action の完了後に
  // 非制御フォームをリセットするため、これが無いと入力内容が消える
  const values = state?.values ?? defaultValues
  const err = (key: string) => state?.errors?.[key]

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)', maxWidth: 640 }}>
      {state?.message && (
        <Notice tone={state.errors || state.values ? 'danger' : 'neutral'} title={state.message} />
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>請求先情報</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 'var(--space-6)' }}>
          <FormField label="顧客名" htmlFor="name" required error={err('name')}>
            <Input id="name" name="name" defaultValue={values.name} invalid={Boolean(err('name'))} placeholder="株式会社◯◯" disabled={readOnly} autoFocus />
          </FormField>
          <FormField label="敬称" htmlFor="honorific" error={err('honorific')} hint="帳票の宛名">
            <Select id="honorific" name="honorific" defaultValue={values.honorific} disabled={readOnly}>
              {HONORIFICS.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </FormField>
        </div>

        <FormField label="担当者名" htmlFor="contactName" error={err('contactName')}>
          <Input id="contactName" name="contactName" defaultValue={values.contactName} placeholder="山田 太郎" disabled={readOnly} />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
          <FormField label="メールアドレス" htmlFor="email" error={err('email')}>
            <Input id="email" name="email" type="email" defaultValue={values.email} invalid={Boolean(err('email'))} disabled={readOnly} />
          </FormField>
          <FormField label="電話番号" htmlFor="phone" error={err('phone')}>
            <Input id="phone" name="phone" defaultValue={values.phone} disabled={readOnly} />
          </FormField>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 'var(--space-6)' }}>
          <FormField label="郵便番号" htmlFor="postalCode" error={err('postalCode')}>
            <Input id="postalCode" name="postalCode" defaultValue={values.postalCode} placeholder="100-0001" disabled={readOnly} />
          </FormField>
          <FormField label="住所" htmlFor="address" error={err('address')}>
            <Input id="address" name="address" defaultValue={values.address} disabled={readOnly} />
          </FormField>
        </div>

        <FormField
          label="適格請求書発行事業者の登録番号"
          htmlFor="invoiceRegistrationNumber"
          error={err('invoiceRegistrationNumber')}
          hint="取引先が免税事業者の場合は空欄のままで構いません"
        >
          <Input
            id="invoiceRegistrationNumber"
            name="invoiceRegistrationNumber"
            defaultValue={values.invoiceRegistrationNumber}
            invalid={Boolean(err('invoiceRegistrationNumber'))}
            placeholder="T1234567890123"
            disabled={readOnly}
          />
        </FormField>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>請求条件</h2>

        {/* 自由入力ではなく選択肢に限定する。「0日締」のような値が入ると
            B6の支払期限の算出が壊れ、直すには既存データの手修正が要る */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-6)' }}>
          <FormField label="締日" htmlFor="closingDay" error={err('closingDay')}>
            <Select id="closingDay" name="closingDay" defaultValue={values.closingDay} disabled={readOnly}>
              <option value="">未設定</option>
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </Select>
          </FormField>
          <FormField label="支払月" htmlFor="paymentMonthOffset" error={err('paymentMonthOffset')}>
            <Select id="paymentMonthOffset" name="paymentMonthOffset" defaultValue={values.paymentMonthOffset} disabled={readOnly}>
              {PAYMENT_MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </FormField>
          <FormField label="支払日" htmlFor="paymentDay" error={err('paymentDay')}>
            <Select id="paymentDay" name="paymentDay" defaultValue={values.paymentDay} disabled={readOnly}>
              <option value="">未設定</option>
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </Select>
          </FormField>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', fontSize: 'var(--text-base)' }}>
          <input type="checkbox" name="withholdingDefault" defaultChecked={values.withholdingDefault} disabled={readOnly} />
          この顧客への請求では源泉徴収を既定でONにする
        </label>
      </section>

      <FormField label="メモ" htmlFor="notes" error={err('notes')}>
        <Input id="notes" name="notes" defaultValue={values.notes} disabled={readOnly} />
      </FormField>

      {!readOnly && (
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '保存中…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
