'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, NumberInput, Select } from '@/components/ui/Input'
import { formatYen } from '@/lib/format'
import { lineAmount, type TaxRate } from '@/lib/tax'
import { lineItemSchema } from '@/server/validators/line-item'
import type { EditableLineItem } from './types'

type Props = {
  items: readonly EditableLineItem[]
  /** 並び順を含む全行を返す。親は受け取った配列をそのまま保持する */
  onChange: (items: EditableLineItem[]) => void
  disabled?: boolean
}

export function newLineItem(): EditableLineItem {
  return {
    key: `new-${Math.random().toString(36).slice(2, 10)}`,
    name: '',
    description: '',
    quantity: 1,
    unit: '',
    unitPrice: 0,
    taxRate: 10,
  }
}

/** DBのCHECK制約と同じ検証を使う(src/server/validators/line-item.ts)。 */
function fieldErrors(item: EditableLineItem, index: number): Partial<Record<string, string>> {
  const parsed = lineItemSchema.safeParse({
    name: item.name,
    description: item.description || null,
    quantity: item.quantity,
    unit: item.unit || null,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    sortOrder: index,
  })
  if (parsed.success) return {}
  const out: Partial<Record<string, string>> = {}
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !out[key]) out[key] = issue.message
  }
  return out
}

/**
 * 明細行エディタ。見積・契約・請求で共用する。
 *
 * 金額(amount)は表示専用。DBトリガーが quantity × unitPrice で算出するため、
 * ここで編集させるとDBの値と食い違う。
 */
export function LineItemEditor({ items, onChange, disabled }: Props) {
  const baseId = useId()

  const update = (index: number, patch: Partial<EditableLineItem>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index))
  const move = (index: number, delta: number) => {
    const to = index + delta
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <div className="sg-items">
      <div className="sg-items__head" aria-hidden>
        <span>品名</span><span>数量</span><span>単位</span><span>単価(税抜)</span>
        <span>税率</span><span>金額</span><span />
      </div>

      {items.map((item, index) => {
        const errors = fieldErrors(item, index)
        const amount = lineAmount(item)
        return (
          <div key={item.key} className="sg-items__row">
            <Input
              aria-label={`${index + 1}行目の品名`}
              id={`${baseId}-name-${index}`}
              value={item.name}
              disabled={disabled}
              invalid={Boolean(errors.name)}
              placeholder="品名"
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <NumberInput
              aria-label={`${index + 1}行目の数量`}
              value={item.quantity}
              min={1}
              step={1}
              disabled={disabled}
              invalid={Boolean(errors.quantity)}
              onChange={(e) => update(index, { quantity: Number(e.target.value) })}
            />
            <Input
              aria-label={`${index + 1}行目の単位`}
              value={item.unit}
              disabled={disabled}
              placeholder="式"
              list={`${baseId}-units`}
              onChange={(e) => update(index, { unit: e.target.value })}
            />
            <NumberInput
              aria-label={`${index + 1}行目の単価(税抜)`}
              value={item.unitPrice}
              step={1}
              disabled={disabled}
              invalid={Boolean(errors.unitPrice)}
              onChange={(e) => update(index, { unitPrice: Number(e.target.value) })}
            />
            <Select
              aria-label={`${index + 1}行目の税率`}
              value={item.taxRate}
              disabled={disabled}
              onChange={(e) => update(index, { taxRate: Number(e.target.value) as TaxRate })}
            >
              <option value={10}>10%</option>
              <option value={8}>8%</option>
            </Select>
            {/* 金額はトリガー算出。表示のみで編集させない */}
            <span className={['sg-amount', amount < 0 && 'sg-amount--negative'].filter(Boolean).join(' ')}>
              {formatYen(amount)}
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button size="sm" variant="text" disabled={disabled || index === 0} aria-label={`${index + 1}行目を上へ`} onClick={() => move(index, -1)}>↑</Button>
              <Button size="sm" variant="text" disabled={disabled || index === items.length - 1} aria-label={`${index + 1}行目を下へ`} onClick={() => move(index, 1)}>↓</Button>
              <Button size="sm" variant="text" disabled={disabled} aria-label={`${index + 1}行目を削除`} onClick={() => remove(index)}>×</Button>
            </div>
            {Object.values(errors).length > 0 && (
              <span className="sg-field__error" role="alert" style={{ gridColumn: '1 / -1' }}>
                {Object.values(errors).join(' / ')}
              </span>
            )}
          </div>
        )
      })}

      <datalist id={`${baseId}-units`}>
        {['式', '個', '人日', '時間', '月', 'ページ'].map((u) => <option key={u} value={u} />)}
      </datalist>

      <div>
        <Button variant="secondary" disabled={disabled} onClick={() => onChange([...items, newLineItem()])}>
          明細を追加
        </Button>
      </div>
    </div>
  )
}
