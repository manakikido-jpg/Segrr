import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: Props) {
  const classes = ['sg-btn', `sg-btn--${variant}`, size === 'sm' && 'sg-btn--sm', className]
  return <button type="button" {...rest} className={classes.filter(Boolean).join(' ')} />
}
