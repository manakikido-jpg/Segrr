import { formatDate, formatQuantity, formatYen } from '@/lib/format'
import type { PdfDocumentData, PdfDocumentKind } from './types'

/** 表題と日付ラベルだけが書類ごとに違う。レイアウト本体は共通。 */
const PRESET: Record<PdfDocumentKind, { title: string; dateLabel: string; dueLabel: string | null }> = {
  quote: { title: '御見積書', dateLabel: '発行日', dueLabel: '有効期限' },
  contract: { title: '契約書', dateLabel: '契約日', dueLabel: null },
  invoice: { title: '御請求書', dateLabel: '発行日', dueLabel: 'お支払期限' },
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, '<br>')

function styles(fontRegular: string, fontBold: string): string {
  return `
@font-face { font-family:'NotoSansJP'; font-weight:400; src:url(${fontRegular}) format('opentype'); }
@font-face { font-family:'NotoSansJP'; font-weight:700; src:url(${fontBold}) format('opentype'); }
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { font-family:'NotoSansJP', sans-serif; font-size:9.5pt; line-height:1.6; color:#1f2937; margin:0; }
h1 { font-size:20pt; font-weight:700; text-align:center; letter-spacing:.4em;
     text-indent:.4em; margin:0 0 10mm; }
.head { display:flex; justify-content:space-between; gap:10mm; margin-bottom:6mm; }
.head__left { flex:1; min-width:0; }
.head__right { width:62mm; font-size:9pt; }
.to { font-size:13pt; font-weight:700; border-bottom:1px solid #1f2937;
      padding-bottom:2mm; margin-bottom:3mm; }
.muted { color:#4b5563; }
.meta { display:flex; justify-content:space-between; gap:4mm; }
.subject { margin:0 0 4mm; }
.grand { border:1px solid #1f2937; padding:3mm 4mm; margin-bottom:6mm;
         display:flex; justify-content:space-between; align-items:baseline; }
.grand__label { font-size:11pt; font-weight:700; }
.grand__value { font-size:18pt; font-weight:700; }
table { width:100%; border-collapse:collapse; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
th, td { border:1px solid #d1d5db; padding:1.8mm 2.5mm; vertical-align:top; }
th { background:#f1f2f4; font-weight:700; font-size:8.5pt; text-align:left; }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
td.center, th.center { text-align:center; white-space:nowrap; }
.item__desc { font-size:8pt; color:#4b5563; }
.negative { color:#b91c1c; }
.foot { display:flex; justify-content:space-between; gap:8mm; margin-top:6mm; break-inside:avoid; }
.foot__left { flex:1; min-width:0; }
.summary { width:78mm; }
.summary table { border-collapse:collapse; }
.summary td { border:none; border-bottom:1px solid #e5e7eb; padding:1.5mm 0; }
.summary .total td { border-bottom:2px solid #1f2937; font-weight:700; font-size:11pt; }
.box { border:1px solid #d1d5db; padding:3mm; font-size:8.5pt; margin-top:4mm; }
.box__title { font-weight:700; margin-bottom:1.5mm; }
`
}

function itemRows(data: PdfDocumentData): string {
  if (data.items.length === 0) {
    return `<tr><td colspan="6" class="center muted">明細がありません</td></tr>`
  }
  return data.items
    .map(
      (it) => `<tr>
  <td>${escapeHtml(it.name)}${it.description ? `<div class="item__desc">${nl2br(it.description)}</div>` : ''}</td>
  <td class="num">${formatQuantity(it.quantity)}</td>
  <td class="center">${escapeHtml(it.unit ?? '')}</td>
  <td class="num${it.unitPrice < 0 ? ' negative' : ''}">${formatYen(it.unitPrice)}</td>
  <td class="center">${it.taxRate}%</td>
  <td class="num${it.amount < 0 ? ' negative' : ''}">${formatYen(it.amount)}</td>
</tr>`,
    )
    .join('\n')
}

/**
 * 税率別サマリ。**適格請求書の要件**として、税率ごとに区分した対価の額と
 * 消費税額を必ず出す。該当する税率が無ければその行は出さない。
 */
function summaryRows(data: PdfDocumentData): string {
  const { totals, withholding } = data
  const rows: string[] = []
  if (totals.subtotal10 !== 0 || totals.tax10 !== 0) {
    rows.push(`<tr><td>10%対象 小計</td><td class="num">${formatYen(totals.subtotal10)}</td></tr>`)
    rows.push(`<tr><td class="muted">　消費税(10%)</td><td class="num">${formatYen(totals.tax10)}</td></tr>`)
  }
  if (totals.subtotal8 !== 0 || totals.tax8 !== 0) {
    rows.push(`<tr><td>8%対象 小計</td><td class="num">${formatYen(totals.subtotal8)}</td></tr>`)
    rows.push(`<tr><td class="muted">　消費税(8%)</td><td class="num">${formatYen(totals.tax8)}</td></tr>`)
  }
  rows.push(`<tr><td>税抜合計</td><td class="num">${formatYen(totals.subtotal)}</td></tr>`)
  rows.push(`<tr><td>消費税合計</td><td class="num">${formatYen(totals.taxAmount)}</td></tr>`)
  rows.push(`<tr class="total"><td>合計(税込)</td><td class="num">${formatYen(totals.totalAmount)}</td></tr>`)
  if (withholding) {
    rows.push(`<tr><td>源泉徴収税額</td><td class="num negative">${formatYen(-withholding.tax)}</td></tr>`)
    rows.push(`<tr class="total"><td>差引請求額</td><td class="num">${formatYen(withholding.paymentAmount)}</td></tr>`)
  }
  return rows.join('\n')
}

/** 帳票のHTMLを組み立てる。PDF化は src/lib/pdf/render.ts が行う。 */
export function buildDocumentHtml(
  data: PdfDocumentData,
  fonts: { regular: string; bold: string },
): string {
  const preset = PRESET[data.kind]
  const issuer = data.issuer
  const grandLabel = data.withholding ? '差引請求額' : '合計金額(税込)'
  const grandValue = data.withholding ? data.withholding.paymentAmount : data.totals.totalAmount

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(preset.title)} ${escapeHtml(data.number)}</title>
<style>${styles(fonts.regular, fonts.bold)}</style></head>
<body>
<h1>${escapeHtml(preset.title)}</h1>

<div class="head">
  <div class="head__left">
    <div class="to">${escapeHtml(data.customerName)} ${escapeHtml(data.customerHonorific ?? '御中')}</div>
    ${data.customerAddress ? `<div class="muted">${nl2br(data.customerAddress)}</div>` : ''}
    <p class="subject">件名: ${escapeHtml(data.subject)}</p>
  </div>
  <div class="head__right">
    <div class="meta"><span class="muted">番号</span><span>${escapeHtml(data.number)}</span></div>
    <div class="meta"><span class="muted">${preset.dateLabel}</span><span>${formatDate(data.issueDate)}</span></div>
    ${preset.dueLabel && data.dueDate ? `<div class="meta"><span class="muted">${preset.dueLabel}</span><span>${formatDate(data.dueDate)}</span></div>` : ''}
    ${data.sequenceNo ? `<div class="meta"><span class="muted">請求回次</span><span>第${data.sequenceNo}回</span></div>` : ''}
    <div style="margin-top:3mm">
      <div style="font-weight:700">${escapeHtml(issuer.name)}</div>
      ${issuer.postalCode ? `<div class="muted">〒${escapeHtml(issuer.postalCode)}</div>` : ''}
      ${issuer.address ? `<div class="muted">${nl2br(issuer.address)}</div>` : ''}
      ${issuer.phone ? `<div class="muted">TEL ${escapeHtml(issuer.phone)}</div>` : ''}
      ${issuer.email ? `<div class="muted">${escapeHtml(issuer.email)}</div>` : ''}
      ${issuer.invoiceRegistrationNumber ? `<div class="muted">登録番号 ${escapeHtml(issuer.invoiceRegistrationNumber)}</div>` : ''}
    </div>
  </div>
</div>

<div class="grand">
  <span class="grand__label">${grandLabel}</span>
  <span class="grand__value">${formatYen(grandValue)}</span>
</div>

<table>
  <thead><tr>
    <th>品名</th><th class="num">数量</th><th class="center">単位</th>
    <th class="num">単価(税抜)</th><th class="center">税率</th><th class="num">金額(税抜)</th>
  </tr></thead>
  <tbody>
${itemRows(data)}
  </tbody>
</table>

<div class="foot">
  <div class="foot__left">
    ${data.notes ? `<div class="box"><div class="box__title">備考</div>${nl2br(data.notes)}</div>` : ''}
    ${data.kind === 'invoice' && issuer.bankAccount ? `<div class="box"><div class="box__title">お振込先</div>${nl2br(issuer.bankAccount)}</div>` : ''}
  </div>
  <div class="summary"><table>${summaryRows(data)}</table></div>
</div>
</body></html>`
}
