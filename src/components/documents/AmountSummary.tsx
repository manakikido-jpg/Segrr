import { formatYen } from '@/lib/format'
import { hasNegativeTaxableBase, type TaxBreakdown } from '@/lib/tax'

type Props = {
  totals: TaxBreakdown
  /** 請求書のみ。源泉徴収を適用しているとき */
  withholding?: { tax: number; paymentAmount: number }
  /**
   * 分割請求の上限。契約の残額(税抜)を渡すと、超過時に超過額を表示する。
   * **比較は税抜で行う**(税込だと税率ごとの端数処理でずれて誤判定するため)。
   */
  limit?: { label: string; subtotal: number }
}

/**
 * 金額サマリ。適格請求書の要件として、税率ごとに区分した対価の額と消費税額を必ず出す。
 * 見積・契約・請求で共用する。
 */
export function AmountSummary({ totals, withholding, limit }: Props) {
  const negativeBase = hasNegativeTaxableBase(totals)
  const over = limit ? totals.subtotal - limit.subtotal : 0

  return (
    <div className="sg-summary">
      {totals.subtotal10 !== 0 || totals.tax10 !== 0 ? (
        <div className="sg-summary__row">
          <span className="sg-summary__label">10%対象 小計</span>
          <span className="sg-amount">{formatYen(totals.subtotal10)}</span>
          <span className="sg-summary__label">消費税</span>
          <span className="sg-amount">{formatYen(totals.tax10)}</span>
        </div>
      ) : null}

      {totals.subtotal8 !== 0 || totals.tax8 !== 0 ? (
        <div className="sg-summary__row">
          <span className="sg-summary__label">8%対象 小計</span>
          <span className="sg-amount">{formatYen(totals.subtotal8)}</span>
          <span className="sg-summary__label">消費税</span>
          <span className="sg-amount">{formatYen(totals.tax8)}</span>
        </div>
      ) : null}

      <div className="sg-summary__rule" />

      <div className="sg-summary__row">
        <span className="sg-summary__label">税抜合計</span>
        <span className="sg-amount">{formatYen(totals.subtotal)}</span>
      </div>
      <div className="sg-summary__row">
        <span className="sg-summary__label">消費税合計</span>
        <span className="sg-amount">{formatYen(totals.taxAmount)}</span>
      </div>
      <div className="sg-summary__row sg-summary__total">
        <span>合計(税込)</span>
        <span className="sg-amount">{formatYen(totals.totalAmount)}</span>
      </div>

      {withholding && (
        <>
          <div className="sg-summary__rule" />
          <div className="sg-summary__row">
            <span className="sg-summary__label">源泉徴収税額</span>
            <span className="sg-amount sg-amount--negative">{formatYen(-withholding.tax)}</span>
          </div>
          <div className="sg-summary__row sg-summary__total">
            <span>差引請求額</span>
            <span className="sg-amount">{formatYen(withholding.paymentAmount)}</span>
          </div>
        </>
      )}

      {negativeBase && (
        <p className="sg-field__error" role="alert">
          値引きが大きすぎます。税率別の小計はマイナスにできません。
        </p>
      )}

      {limit && over > 0 && (
        <p className="sg-field__error" role="alert">
          {limit.label} {formatYen(limit.subtotal)} を {formatYen(over)} 超えています(いずれも税抜)。
        </p>
      )}
    </div>
  )
}
