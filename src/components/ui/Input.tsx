import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }

export function Input({ invalid, className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={['sg-input', invalid && 'sg-input--invalid', className].filter(Boolean).join(' ')}
    />
  )
}

/** 金額・数量用。右揃え・等幅で表示する(デザイン仕様)。 */
export function NumberInput({ invalid, className = '', ...rest }: InputProps) {
  return (
    <input
      inputMode="numeric"
      {...rest}
      type="number"
      aria-invalid={invalid || undefined}
      className={['sg-input', 'sg-input--number', invalid && 'sg-input--invalid', className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

/** 日付は 'YYYY-MM-DD' 文字列で扱う。Date への変換はサービス層の境界1箇所に閉じる。 */
export function DateInput({ invalid, className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      type="date"
      aria-invalid={invalid || undefined}
      className={['sg-input', invalid && 'sg-input--invalid', className].filter(Boolean).join(' ')}
    />
  )
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }

export function Select({ invalid, className = '', ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      className={['sg-input', invalid && 'sg-input--invalid', className].filter(Boolean).join(' ')}
    />
  )
}
