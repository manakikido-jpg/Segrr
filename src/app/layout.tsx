import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Segrr',
  description: '個人事業主のための書類管理ツール',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
