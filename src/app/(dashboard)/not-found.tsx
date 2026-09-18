import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * 存在しないIDを開いたときの受け皿。
 * **他組織のデータを指していた場合もここに来る**(サービス層が組織で絞るため)。
 * 「存在しない」と「見る権限がない」を区別しないのは、他組織にそのIDが
 * 存在するかどうかを推測させないため。
 */
export default function DashboardNotFound() {
  return (
    <EmptyState
      title="お探しのページが見つかりません"
      description="削除されたか、URLが正しくない可能性があります。"
      action={<Link href="/"><Button variant="secondary">ダッシュボードへ</Button></Link>}
    />
  )
}
