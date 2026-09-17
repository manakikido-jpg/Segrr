/**
 * ステータスバッジ。
 *
 * Prisma の enum を直接受けない。理由は2つ:
 *  - 見積・契約・請求で enum が別物なのに見た目は共通のため
 *  - 「期限切れ」「あとN日」はDBに保存しない派生状態(要件定義書セクション2)で、
 *    enum からは作れないため
 * enum → variant の対応と期限の判定は src/components/documents/status.ts にある。
 */
export type BadgeVariant = 'draft' | 'sent' | 'ok' | 'danger' | 'neutral' | 'warn'

type Props = {
  variant: BadgeVariant
  label: string
  /** 日付から算出した状態は面を使わず枠線だけで区別する(デザイン仕様) */
  outline?: boolean
}

export function StatusBadge({ variant, label, outline }: Props) {
  return (
    <span className={['sg-badge', `sg-badge--${variant}`, outline && 'sg-badge--outline'].filter(Boolean).join(' ')}>
      {!outline && <span className="sg-badge__dot" aria-hidden />}
      {label}
    </span>
  )
}
