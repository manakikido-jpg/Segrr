import { z } from 'zod'
import { lineAmount, MAX_LINE_AMOUNT, MAX_QUANTITY } from '@/lib/tax'

/**
 * 明細行の入力検証。
 *
 * **DBのCHECK制約とトリガー(docs/db-constraints.sql)を鏡写しにしている。**
 * ここが緩いと、UIでは通った入力がDBで例外になり、トリガーの日本語例外が
 * そのままユーザーに出る。制約を変えるときは両方を同時に直すこと。
 *
 * 同じスキーマを LineItemEditor(クライアント)と API(サーバー)の両方で使う。
 */
export const TAX_RATES = [10, 8] as const

export const lineItemSchema = z.object({
  name: z.string().trim().min(1, '品名を入力してください').max(200, '品名が長すぎます'),
  description: z.string().trim().max(500).nullish(),
  // DB: CHECK ("quantity" > 0 AND "quantity" <= 100000)。Decimal(10,2) のため小数第2位まで。
  // 半日単位(0.5人日)・時間単位(7.5時間)・15分単位(0.25時間)の請求に対応する。
  quantity: z
    .number({ message: '数量を入力してください' })
    .positive('数量は0より大きい値を入力してください')
    .max(MAX_QUANTITY, '数量が大きすぎます')
    .refine(
      (q) => Math.abs(q * 100 - Math.round(q * 100)) < 1e-9,
      '数量は小数第2位まで(0.25 刻み)で入力してください',
    ),
  unit: z.string().trim().max(20).nullish(),
  // DB: CHECK ("unitPrice" BETWEEN -1000000000 AND 1000000000)
  // マイナスを許すのは値引き行のため(デザイン仕様)
  unitPrice: z
    .number({ message: '単価を入力してください' })
    .int('単価は円単位の整数で入力してください')
    .min(-1_000_000_000, '単価が小さすぎます')
    .max(1_000_000_000, '単価が大きすぎます'),
  // DB: CHECK ("taxRate" IN (8, 10))
  taxRate: z.union([z.literal(10), z.literal(8)]),
  sortOrder: z.number().int().min(0),
})

  .refine(
    // DBの segrr_set_item_amount() が同じ検査をする。ここで弾かないと
    // トリガーの例外がそのままユーザーに出る
    (item) => Math.abs(lineAmount(item)) <= MAX_LINE_AMOUNT,
    { message: '金額が大きすぎます。数量または単価を見直してください', path: ['unitPrice'] },
  )

export type LineItemInputValues = z.infer<typeof lineItemSchema>

export const lineItemsSchema = z.array(lineItemSchema)
