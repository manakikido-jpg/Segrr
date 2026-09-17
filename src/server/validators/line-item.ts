import { z } from 'zod'

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
  // DB: CHECK ("quantity" > 0)。Int のため小数は受け付けない
  quantity: z
    .number({ message: '数量を入力してください' })
    .int('数量は整数で入力してください')
    .positive('数量は1以上で入力してください'),
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

export type LineItemInputValues = z.infer<typeof lineItemSchema>

export const lineItemsSchema = z.array(lineItemSchema)
