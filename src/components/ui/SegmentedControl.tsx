'use client'

type Option<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
}

export function SegmentedControl<T extends string>({ options, value, onChange, ...rest }: Props<T>) {
  return (
    <div className="sg-segmented" role="tablist" aria-label={rest['aria-label']}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className="sg-segmented__item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
