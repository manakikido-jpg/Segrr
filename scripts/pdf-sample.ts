import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  closePdfBrowser,
  renderDocumentPdf,
  type PdfDocumentData,
  type PdfLineItem,
} from '../src/lib/pdf'
import { calculateInvoiceAmounts, calculateTax, lineAmount, type LineItemInput } from '../src/lib/tax'

/**
 * ダミーデータで帳票PDFを出力する(タスクA4の完了条件)。
 *   npm run pdf:sample [出力先ディレクトリ]
 *
 * 認証(B1)より前の段階なので、DBを読む [id] ルートはまだ作らない。
 * テナント境界の検査が入らない配信口を先に用意すると、B4でそのまま流用されて
 * 他組織の書類を取得できる穴になるため(配信ルートはB4の成果物)。
 */

const issuer = {
  name: '木戸 眞己',
  postalCode: '150-0001',
  address: '東京都渋谷区神宮前0-0-0\nサンプルビル 5F',
  phone: '03-0000-0000',
  email: 'billing@example.com',
  // 免税事業者を想定して未設定。欄ごと出ないこと(デザイン仕様)
  invoiceRegistrationNumber: null,
  bankAccount: 'サンプル銀行 渋谷支店(普通)1234567\n名義 キド マナキ',
}

type SampleItem = LineItemInput & { name: string; unit?: string; description?: string }

/** 明細に金額(数量 × 単価)を付ける。実運用ではDBトリガーが算出した値を渡す。 */
function withAmounts(items: readonly SampleItem[]): PdfLineItem[] {
  return items.map((it) => ({ ...it, amount: lineAmount(it) }))
}

const baseItems = [
  {
    name: 'Webサイト制作費',
    description: 'トップページ・下層5ページのデザインおよび実装',
    quantity: 1, unit: '式', unitPrice: 500_000, taxRate: 10 as const,
  },
  { name: '追加実装(工数精算)', quantity: 5, unit: '人日', unitPrice: 80_000, taxRate: 10 as const },
  { name: '説明用の小冊子制作(軽減税率対象)', quantity: 3, unit: '部', unitPrice: 333, taxRate: 8 as const },
  { name: '継続契約割引', quantity: 1, unit: '式', unitPrice: -50_000, taxRate: 10 as const },
]

/** 折り返し・改ページの確認用。長い品名(空白なし)と多数行を含める */
const stressItems = [
  {
    name: 'レスポンシブ対応込みコーポレートサイトリニューアル一式及び既存コンテンツ移行作業費用',
    description: '長い説明の折り返し確認。'.repeat(8),
    quantity: 1, unit: '式', unitPrice: 1_200_000, taxRate: 10 as const,
  },
  ...Array.from({ length: 30 }, (_, i) => ({
    name: `下層ページ制作 ${String(i + 1).padStart(2, '0')}`,
    quantity: 1, unit: 'ページ', unitPrice: 30_000 + i * 100, taxRate: 10 as const,
  })),
]

function quote(): PdfDocumentData {
  const items = withAmounts(baseItems)
  return {
    kind: 'quote', number: 'EST-0091', subject: 'コーポレートサイト リニューアル',
    customerName: '株式会社サンプル商事', customerHonorific: '御中',
    customerAddress: '〒100-0001 東京都千代田区千代田1-1-1',
    issueDate: '2026-09-17', dueDate: '2026-10-17',
    issuer, items, totals: calculateTax(baseItems),
    notes: '本見積書の有効期限は発行日より1ヶ月です。\n記載金額には別途消費税が加算されます。',
  }
}

function contract(): PdfDocumentData {
  const items = withAmounts(baseItems)
  return {
    kind: 'contract', number: 'CTR-0031', subject: 'コーポレートサイト リニューアル',
    customerName: '株式会社サンプル商事', customerHonorific: '御中',
    issueDate: '2026-09-20', issuer, items, totals: calculateTax(baseItems),
    notes: '第1条(目的) 本契約は、甲が乙に対し前記業務を委託することを目的とする。\n第2条(納期) 2026年12月末日とする。',
  }
}

function invoice(): PdfDocumentData {
  const items = [{ name: '着手金(契約金額の50%)', quantity: 1, unit: '式', unitPrice: 425_000, taxRate: 10 as const }]
  const amounts = calculateInvoiceAmounts(items, { withholdingApplied: true })
  return {
    kind: 'invoice', number: 'INV-0129', subject: 'コーポレートサイト リニューアル',
    customerName: '株式会社サンプル商事', customerHonorific: '御中',
    issueDate: '2026-09-30', dueDate: '2026-10-31', sequenceNo: 1,
    issuer: { ...issuer, invoiceRegistrationNumber: 'T1234567890123' },
    items: withAmounts(items), totals: amounts,
    withholding: { tax: amounts.withholdingTax, paymentAmount: amounts.paymentAmount },
    notes: '恐れ入りますが、振込手数料は貴社にてご負担をお願いいたします。',
  }
}

function stress(): PdfDocumentData {
  return {
    kind: 'quote', number: 'EST-STRESS', subject: '改ページと折り返しの確認',
    customerName: '長い会社名テスト株式会社ホールディングス', customerHonorific: '御中',
    issueDate: '2026-09-17', issuer, items: withAmounts(stressItems),
    totals: calculateTax(stressItems), notes: '備考の折り返し確認。'.repeat(20),
  }
}

async function main() {
  const outDir = process.argv[2] ?? 'tmp/pdf-sample'
  await mkdir(outDir, { recursive: true })
  for (const [name, data] of Object.entries({ quote: quote(), contract: contract(), invoice: invoice(), stress: stress() })) {
    const buf = await renderDocumentPdf(data)
    const file = path.join(outDir, `${name}.pdf`)
    await writeFile(file, buf)
    console.log(`${file}  ${Math.round(buf.length / 1024)}KB`)
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(closePdfBrowser)
