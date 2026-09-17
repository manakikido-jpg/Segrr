import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { buildDocumentHtml } from './template'
import type { PdfDocumentData } from './types'

/**
 * 帳票PDFの生成。HTMLを headless Chromium で印刷する。
 *
 * この方式を選んだ理由(A4の技術検証):
 *  - 日本の帳票は罫線の多い表が中心で、CSSの table がそのまま使える。
 *    React-PDF は flexbox の部分実装で、罫線・折り返し・改ページを手で組む必要があり、
 *    要件定義書セクション5の失敗パターン3(帳票レイアウトに工数が溶ける)を招きやすい。
 *  - 画面用のデザイントークンと同じ値をそのまま使える。
 *  - 実測で1書類あたり約1秒。
 *
 * 引き換えに、デプロイ先に Chromium が必要になる。Vercel に載せる場合は
 * @sparticuz/chromium を使うか、PDF生成だけ別ワーカーに分離する
 * (要件定義書セクション4が想定している構成)。実行ファイルのパスは
 * CHROMIUM_EXECUTABLE_PATH で差し替えられるようにしてある。
 */

const FONT_DIR = path.join(process.cwd(), 'src/assets/fonts')

let fontCache: { regular: string; bold: string } | undefined

/**
 * フォントを data: URI にして埋め込む。
 * **システムフォントに任せてはいけない。** 指定しないと Chromium が別のCJKフォントへ
 * フォールバックし、中国語字形で印字される(実測で確認済み)。サーバーによっては
 * 日本語フォントが無く豆腐になる。
 */
async function loadFonts() {
  if (fontCache) return fontCache
  const [regular, bold] = await Promise.all([
    readFile(path.join(FONT_DIR, 'NotoSansJP-Regular.otf')),
    readFile(path.join(FONT_DIR, 'NotoSansJP-Bold.otf')),
  ])
  fontCache = {
    regular: `data:font/otf;base64,${regular.toString('base64')}`,
    bold: `data:font/otf;base64,${bold.toString('base64')}`,
  }
  return fontCache
}

let browserPromise: Promise<Browser> | undefined

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
  }
  return browserPromise
}

/** 生成に使った Chromium を閉じる。スクリプトやテストの終了時に呼ぶ。 */
export async function closePdfBrowser(): Promise<void> {
  if (!browserPromise) return
  const browser = await browserPromise
  browserPromise = undefined
  await browser.close()
}

/**
 * 見積書・契約書・請求書のPDFを生成する。
 *
 * 呼び出し側の責任: `data` は必ずDBから読んだ値を渡すこと。金額をここで計算しない
 * (金額の正はDBにある。docs/db-constraints.sql)。
 */
export async function renderDocumentPdf(data: PdfDocumentData): Promise<Buffer> {
  const fonts = await loadFonts()
  const html = buildDocumentHtml(data, fonts)

  const browser = await getBrowser()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    // フォントの読み込み完了を待たないと、埋め込みフォントが効かないままPDF化される
    await page.evaluate(() => document.fonts.ready)
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#4b5563;text-align:center;padding:0 15mm">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '16mm', right: '15mm', bottom: '18mm', left: '15mm' },
    })
  } finally {
    await context.close()
  }
}
