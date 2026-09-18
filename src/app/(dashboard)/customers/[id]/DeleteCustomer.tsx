'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Notice'
import type { FormState } from '../actions'

type Props = {
  action: (prev: FormState) => Promise<FormState>
  projectCount: number
  customerName: string
  readOnly?: boolean
}

/**
 * 顧客の削除。案件を持つ顧客は削除できないので、**ボタンを消さずに理由を出す**
 * (デザイン仕様の「グレーアウトだけにしない」)。
 */
export function DeleteCustomer({ action, projectCount, customerName, readOnly }: Props) {
  const [state, formAction, pending] = useActionState(action, null)

  if (readOnly) {
    return (
      <Notice title="削除できません">
        閲覧のみのユーザーは顧客を削除できません。
      </Notice>
    )
  }

  if (projectCount > 0) {
    return (
      <Notice
        title="この顧客は削除できません"
        actions={null}
      >
        案件が{projectCount}件ひもづいています。先に案件を削除するか、別の顧客に付け替えてください。
      </Notice>
    )
  }

  return (
    <form
      action={formAction}
      // 削除は取り消せないので、送信前に一度確認する
      onSubmit={(e) => {
        if (!window.confirm(`「${customerName}」を削除します。元に戻せません。よろしいですか?`)) {
          e.preventDefault()
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      {state?.message && <Notice tone="danger" title={state.message} />}
      <div>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? '削除中…' : 'この顧客を削除'}
        </Button>
      </div>
    </form>
  )
}
