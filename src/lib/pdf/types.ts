import type { TaxBreakdown } from '@/lib/tax'

/**
 * PDF帳票に渡すデータ。
 *
 * **Prisma の型に依存させない。** 見積・契約・請求で別々のモデルになっているが、
 * 帳票の体裁はほぼ同じで、差分は表題・日付の名称・源泉徴収・請求回次だけのため、
 * 1つの型と1つのレイアウトで受ける。書類ごとにレイアウトを複製すると、
 * 登録番号の印字位置や宛名の敬称を直すたびに3箇所を触ることになる。
 */
export type PdfDocumentKind = 'quote' | 'contract' | 'invoice'

export type PdfLineItem = {
  name: string
  description?: string | null
  /** 数量。小数第2位まで(0.5人日 / 7.5時間 など) */
  quantity: number
  unit?: string | null
  unitPrice: number
  taxRate: 10 | 8
  amount: number
}

export type PdfIssuer = {
  name: string
  postalCode?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  /** 適格請求書発行事業者の登録番号。未取得(免税事業者)なら null。欄ごと出さない */
  invoiceRegistrationNumber?: string | null
  /** 請求書の振込先。複数行可 */
  bankAccount?: string | null
}

export type PdfDocumentData = {
  kind: PdfDocumentKind
  /** 見積番号・契約番号・請求番号 */
  number: string
  /** 件名(案件名) */
  subject: string
  /** 宛名。法人なら「御中」、個人なら「様」 */
  customerName: string
  customerHonorific?: '御中' | '様'
  customerAddress?: string | null
  /** 取引年月日(適格請求書の必須項目)。YYYY-MM-DD */
  issueDate: string | null
  /** 見積の有効期限 / 請求の支払期限。YYYY-MM-DD */
  dueDate?: string | null
  issuer: PdfIssuer
  items: readonly PdfLineItem[]
  totals: TaxBreakdown
  /** 請求書で源泉徴収を適用しているとき */
  withholding?: { tax: number; paymentAmount: number } | null
  /** 請求書の請求回次(分割請求) */
  sequenceNo?: number | null
  notes?: string | null
}
