/**
 * 消費税と源泉徴収の計算。
 *
 * **この計算は表示用(UIプレビュー)です。金額の正はDBにあります。**
 * 実際に保存される値は docs/db-constraints.sql のトリガーが算出します。
 * ここはユーザーが入力している最中に即座に合計を見せるためだけに使い、
 * 結果をDBに書き込んではいけません。
 *
 * DBと1円でもずれると「画面と発行済みPDFの金額が違う」事故になるため、
 * tests/unit/tax.test.ts で tests/db/verify-constraints.sql と同じケースを固定しています。
 *
 * 浮動小数点を避けて整数演算だけで計算しているのは、PostgreSQL 側が NUMERIC(正確な10進数)で
 * 計算しているためです。JavaScript の number で `999 * 0.08` を計算すると 79.92000000000002 に
 * なり、丸め方によってはDBと1円ずれます。
 */

export type TaxRate = 10 | 8
export type TaxRounding = 'FLOOR' | 'ROUND' | 'CEIL'

export type LineItemInput = {
  quantity: number
  /** 税抜単価。値引き行はマイナス */
  unitPrice: number
  taxRate: TaxRate
}

export type TaxBreakdown = {
  /** 10%対象の税抜小計 */
  subtotal10: number
  tax10: number
  /** 8%(軽減税率)対象の税抜小計 */
  subtotal8: number
  tax8: number
  /** 税抜合計 */
  subtotal: number
  /** 消費税額合計 */
  taxAmount: number
  /** 税込合計 */
  totalAmount: number
}

/** 明細1行の金額(税抜)。DBの segrr_set_item_amount() と同じ。 */
export function lineAmount(item: LineItemInput): number {
  return item.quantity * item.unitPrice
}

/**
 * 端数処理。PostgreSQL の segrr_round() と同じ挙動。
 * 引数は「税抜小計 × 税率」を分子、100 を分母とした分数として整数で渡す。
 */
function applyRounding(numerator: number, mode: TaxRounding): number {
  const quotient = Math.floor(numerator / 100)
  const remainder = numerator - quotient * 100
  if (remainder === 0) return quotient
  switch (mode) {
    case 'FLOOR':
      return quotient
    case 'CEIL':
      return quotient + 1
    case 'ROUND':
      // PostgreSQL の round() は 0.5 を絶対値の大きい方へ丸める
      return remainder >= 50 ? quotient + 1 : quotient
  }
}

/**
 * 書類全体の税額を計算する。
 *
 * **端数処理は1書類につき税率ごとに1回だけ適用する。** 明細行ごとに丸めると税額がずれ、
 * 適格請求書の要件にも反する(例: 333円の明細3行を8%で計算すると、行ごとなら
 * floor(26.64)×3 = 78円、書類単位なら floor(79.92) = 79円)。
 */
export function calculateTax(
  items: readonly LineItemInput[],
  rounding: TaxRounding = 'FLOOR',
): TaxBreakdown {
  let subtotal10 = 0
  let subtotal8 = 0
  for (const item of items) {
    const amount = lineAmount(item)
    if (item.taxRate === 10) subtotal10 += amount
    else subtotal8 += amount
  }

  const tax10 = applyRounding(subtotal10 * 10, rounding)
  const tax8 = applyRounding(subtotal8 * 8, rounding)

  return {
    subtotal10,
    tax10,
    subtotal8,
    tax8,
    subtotal: subtotal10 + subtotal8,
    taxAmount: tax10 + tax8,
    totalAmount: subtotal10 + subtotal8 + tax10 + tax8,
  }
}

/**
 * 税率別の小計がマイナスになっていないか。値引き行が大きすぎると課税対象が
 * マイナスになり、消費税額もマイナスになって意味をなさない(DBトリガーも拒否する)。
 */
export function hasNegativeTaxableBase(breakdown: TaxBreakdown): boolean {
  return breakdown.subtotal10 < 0 || breakdown.subtotal8 < 0
}

/**
 * 源泉徴収税額。DBの segrr_withholding_tax() と同じ。
 *
 * 消費税を区分して記載しているため税抜額を対象にする。
 * 税抜額が100万円以下なら 10.21%、100万円を超える場合は超過分に 20.42% を掛けて
 * 102,100円を足す。いずれも円未満切り捨て。
 */
export function calculateWithholdingTax(taxExcludedBase: number): number {
  if (taxExcludedBase <= 0) return 0
  if (taxExcludedBase <= 1_000_000) {
    return Math.floor((taxExcludedBase * 1021) / 10_000)
  }
  return Math.floor(((taxExcludedBase - 1_000_000) * 2042) / 10_000) + 102_100
}

export type InvoiceAmounts = TaxBreakdown & {
  withholdingTax: number
  /** 差引請求額(税込合計 - 源泉徴収税額) */
  paymentAmount: number
}

/** 請求書の金額。源泉徴収の適用有無を受け取り、差引請求額まで返す。 */
export function calculateInvoiceAmounts(
  items: readonly LineItemInput[],
  options: { rounding?: TaxRounding; withholdingApplied?: boolean } = {},
): InvoiceAmounts {
  const breakdown = calculateTax(items, options.rounding ?? 'FLOOR')
  const withholdingTax = options.withholdingApplied
    ? calculateWithholdingTax(breakdown.subtotal)
    : 0
  return {
    ...breakdown,
    withholdingTax,
    paymentAmount: breakdown.totalAmount - withholdingTax,
  }
}
