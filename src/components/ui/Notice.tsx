import type { ReactNode } from 'react'

type Props = {
  tone?: 'neutral' | 'danger'
  title: string
  children?: ReactNode
  /** 代替手段への導線。ロック時は「なぜできないか」と一緒に必ず出す(デザイン仕様) */
  actions?: ReactNode
}

/**
 * 編集ロックや金額超過の説明。グレーアウトだけで済ませず、
 * 理由と代わりに取れる行動を必ず併記する(デザイン仕様の「編集ロック」)。
 */
export function Notice({ tone = 'neutral', title, children, actions }: Props) {
  return (
    <div className={['sg-notice', tone === 'danger' && 'sg-notice--danger'].filter(Boolean).join(' ')} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="sg-notice__title">{title}</span>
      {children}
      {actions && <div className="sg-notice__actions">{actions}</div>}
    </div>
  )
}
