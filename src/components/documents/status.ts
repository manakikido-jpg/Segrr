import type { BadgeVariant } from '@/components/ui/StatusBadge'
import { daysUntil } from '@/lib/format'

/**
 * ステータスの表示ルール。
 *
 * 「期限切れ」「あとN日」はDBに保存しない(要件定義書セクション2)。保存すると更新漏れで
 * 必ず実態とずれるため、日付から毎回導出する。ステータスを置き換えるのではなく、
 * 枠線バッジとして重ねて表示する(デザイン仕様)。
 */

export type Badge = { variant: BadgeVariant; label: string; outline?: boolean }

const QUOTE: Record<string, Badge> = {
  DRAFT: { variant: 'draft', label: '下書き' },
  SENT: { variant: 'sent', label: '送付済' },
  ACCEPTED: { variant: 'ok', label: '承認済' },
  REJECTED: { variant: 'danger', label: '却下' },
}

const CONTRACT: Record<string, Badge> = {
  DRAFT: { variant: 'draft', label: '下書き' },
  SENT: { variant: 'sent', label: '送付済' },
  SIGNED: { variant: 'ok', label: '締結済' },
  CANCELLED: { variant: 'neutral', label: 'キャンセル' },
}

const INVOICE: Record<string, Badge> = {
  DRAFT: { variant: 'draft', label: '下書き' },
  SENT: { variant: 'sent', label: '送付済' },
  PAID: { variant: 'ok', label: '入金済' },
  CANCELLED: { variant: 'neutral', label: 'キャンセル' },
}

const TABLES = { quote: QUOTE, contract: CONTRACT, invoice: INVOICE } as const

export function statusBadge(kind: keyof typeof TABLES, status: string): Badge {
  return TABLES[kind][status] ?? { variant: 'neutral', label: status }
}

/**
 * 期限から導出するバッジ。ステータスに重ねて表示する。
 * - 入金済・キャンセル・却下には出さない(実害がないため)
 * - 承認済の見積は有効期限を過ぎても警告色にしない(デザイン仕様)
 * - 期限3日前から「あとN日」を出す
 */
export function deadlineBadge(
  args: { status: string; due: Date | string | null | undefined; now?: Date },
): Badge | null {
  const { status, due } = args
  if (!due) return null
  if (status === 'PAID' || status === 'CANCELLED' || status === 'REJECTED') return null

  const days = daysUntil(due, args.now ?? new Date())
  if (days === null) return null

  if (days < 0) {
    if (status === 'ACCEPTED') return { variant: 'neutral', label: '期限切れ', outline: true }
    return { variant: 'danger', label: '期限切れ', outline: true }
  }
  if (days <= 3) {
    return { variant: 'warn', label: days === 0 ? '本日期限' : `あと${days}日`, outline: true }
  }
  return null
}
