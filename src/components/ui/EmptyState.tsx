import type { ReactNode } from 'react'

type Props = { title: string; description?: string; action?: ReactNode }

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="sg-empty">
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  )
}
