import type { TaxRate } from '@/lib/tax'

/**
 * 見積・契約・請求で共用する明細の型。
 *
 * **Prisma の型に依存させない。** 3つの書類で別々のモデル(QuoteItem / ContractItem /
 * InvoiceItem)になっているが、編集UIと金額サマリは同じものを使うため。
 */
export type EditableLineItem = {
  /** クライアント側で採番する行キー。新規行にはDBのidが無いため必須 */
  key: string
  /** 既存行のDB id(新規行は undefined) */
  id?: string
  name: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  taxRate: TaxRate
}

export type DocumentKind = 'quote' | 'contract' | 'invoice'
