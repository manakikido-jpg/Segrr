import { describe, expect, it } from 'vitest'
import {
  calculateInvoiceAmounts,
  calculateTax,
  calculateWithholdingTax,
  hasNegativeTaxableBase,
  type LineItemInput,
  type TaxRounding,
} from '@/lib/tax'
import fixture from '../fixtures/tax-cases.json'

/**
 * 期待値は tests/fixtures/tax-cases.json に置き、DB側の検証
 * (tests/unit/tax-db.test.ts)も同じファイルを読む。
 * TS側だけで期待値を手書きすると、同じ式から導いた値で同じ式を検証する循環になり、
 * DBトリガーとのずれを検出できない。
 */
describe('calculateTax — フィクスチャと一致すること', () => {
  for (const c of fixture.taxCases) {
    it(c.name, () => {
      const result = calculateTax(
        c.items as LineItemInput[],
        c.rounding as TaxRounding,
      )
      expect(result).toEqual(c.expected)
    })
  }
})

describe('calculateWithholdingTax — フィクスチャと一致すること', () => {
  for (const c of fixture.withholdingCases) {
    it(`税抜 ${c.base.toLocaleString('ja-JP')}円 → ${c.expected.toLocaleString('ja-JP')}円`, () => {
      expect(calculateWithholdingTax(c.base)).toBe(c.expected)
    })
  }
})

describe('端数処理の単位', () => {
  it('明細行ごとではなく書類単位で丸める', () => {
    const items: LineItemInput[] = [
      { quantity: 1, unitPrice: 333, taxRate: 8 },
      { quantity: 1, unitPrice: 333, taxRate: 8 },
      { quantity: 1, unitPrice: 333, taxRate: 8 },
    ]
    // 行ごとに丸めると floor(26.64) × 3 = 78 になる
    const perLine = items.reduce((sum, i) => sum + Math.floor((i.quantity * i.unitPrice * 8) / 100), 0)
    expect(perLine).toBe(78)
    expect(calculateTax(items, 'FLOOR').tax8).toBe(79)
  })
})

describe('値引き行', () => {
  it('課税対象がマイナスになったら検出する', () => {
    const totals = calculateTax(
      [
        { quantity: 1, unitPrice: 100_000, taxRate: 10 },
        { quantity: 1, unitPrice: -200_000, taxRate: 10 },
      ],
      'FLOOR',
    )
    expect(totals.subtotal10).toBe(-100_000)
    expect(hasNegativeTaxableBase(totals)).toBe(true)
  })

  it('課税対象が正なら検出しない', () => {
    expect(hasNegativeTaxableBase(calculateTax([{ quantity: 1, unitPrice: 100, taxRate: 10 }]))).toBe(false)
  })
})

describe('calculateInvoiceAmounts', () => {
  const items: LineItemInput[] = [{ quantity: 1, unitPrice: 1_000_000, taxRate: 10 }]

  it('源泉徴収を適用すると差引請求額が出る', () => {
    const r = calculateInvoiceAmounts(items, { withholdingApplied: true })
    expect(r.totalAmount).toBe(1_100_000)
    expect(r.withholdingTax).toBe(102_100)
    expect(r.paymentAmount).toBe(997_900)
  })

  it('適用しなければ源泉徴収は0で、差引請求額は税込合計と同じ', () => {
    const r = calculateInvoiceAmounts(items, { withholdingApplied: false })
    expect(r.withholdingTax).toBe(0)
    expect(r.paymentAmount).toBe(r.totalAmount)
  })

  it('源泉徴収の対象は税率をまたいだ税抜合計(税込ではない)', () => {
    const mixed: LineItemInput[] = [
      { quantity: 1, unitPrice: 900_000, taxRate: 10 },
      { quantity: 1, unitPrice: 100_000, taxRate: 8 },
    ]
    const r = calculateInvoiceAmounts(mixed, { withholdingApplied: true })
    expect(r.subtotal).toBe(1_000_000)
    expect(r.withholdingTax).toBe(calculateWithholdingTax(1_000_000))
  })
})
