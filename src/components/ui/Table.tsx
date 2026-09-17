import type { ReactNode, TableHTMLAttributes } from 'react'

export function Table({ children, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="sg-table-wrap">
      <table {...rest} className="sg-table">
        {children}
      </table>
    </div>
  )
}

/** 金額セル。右揃え・等幅・3桁区切りはここに集約する。 */
export function AmountCell({ children, negative }: { children: ReactNode; negative?: boolean }) {
  return (
    <td className={['sg-num', negative && 'sg-amount--negative'].filter(Boolean).join(' ')}>{children}</td>
  )
}
