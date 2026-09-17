/**
 * 表示用のフォーマット。金額は等幅・右揃え・3桁区切りで出す(デザイン仕様)。
 *
 * **日付は必ず Asia/Tokyo で解釈する。** 日付だけの値(発行日・支払期限・契約日)は
 * JSTの0時で保存されるため、UTCで動くサーバー(Vercelの Route Handler など)で
 * ローカルタイムゾーンのまま整形すると1日前になる。
 * 10月1日発行の請求書PDFに「2026年9月30日」と印字されると、適格請求書の
 * 必須項目(取引年月日)がずれる。
 */

const JST = 'Asia/Tokyo'

/** 1,234 / -50,000 のように3桁区切りにする。記号は付けない。 */
export function formatNumber(value: number): string {
  return value.toLocaleString('ja-JP')
}

/** ¥1,234 / -¥50,000。マイナスは記号の前に付ける(デザイン仕様)。 */
export function formatYen(value: number): string {
  return value < 0 ? `-¥${formatNumber(Math.abs(value))}` : `¥${formatNumber(value)}`
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? null : d
}

/** JSTでの年・月・日を取り出す。以降の日付処理はすべてこれを起点にする。 */
export function jstParts(value: Date | string | null | undefined):
  | { year: number; month: number; day: number }
  | null {
  const d = toDate(value)
  if (!d) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** 2026年9月17日 */
export function formatDate(value: Date | string | null | undefined): string {
  const p = jstParts(value)
  return p ? `${p.year}年${p.month}月${p.day}日` : ''
}

/** 2026-09-17(日付入力欄・PDFの日付欄向け) */
export function formatDateISO(value: Date | string | null | undefined): string {
  const p = jstParts(value)
  if (!p) return ''
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** JSTの「今日」を YYYY-MM-DD で返す。 */
export function todayISO(now = new Date()): string {
  return formatDateISO(now)
}

/**
 * 期限までの残日数(JST基準)。過ぎていればマイナス、当日は0。
 * 「期限切れ」「あとN日」はDBに保存せず、表示時にここで判定する
 * (保存すると更新漏れで必ず実態とずれるため。要件定義書セクション2)。
 */
export function daysUntil(
  due: Date | string | null | undefined,
  now = new Date(),
): number | null {
  const a = jstParts(due)
  const b = jstParts(now)
  if (!a || !b) return null
  const ua = Date.UTC(a.year, a.month - 1, a.day)
  const ub = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((ua - ub) / 86_400_000)
}

/** 支払期限・有効期限を過ぎているか(当日はまだ過ぎていない)。 */
export function isPastDue(
  due: Date | string | null | undefined,
  now = new Date(),
): boolean {
  const days = daysUntil(due, now)
  return days !== null && days < 0
}
