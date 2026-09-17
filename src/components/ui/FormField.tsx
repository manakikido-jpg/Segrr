import type { ReactNode } from 'react'

type Props = {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
}

export function FormField({ label, htmlFor, required, hint, error, children }: Props) {
  return (
    <div className="sg-field">
      <label className="sg-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="sg-field__required" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <span className="sg-field__hint">{hint}</span>}
      {error && <span className="sg-field__error" role="alert">{error}</span>}
    </div>
  )
}
