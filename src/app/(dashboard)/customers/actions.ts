'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, type ActiveOrganization } from '@/server/auth/types'
import { requireOrganization } from '@/server/auth/session'
import {
  createCustomer,
  deleteCustomer,
  updateCustomer,
} from '@/server/services/customer-service'
import {
  customerInputFromFormData,
  formValuesFromFormData,
  type CustomerFormValues,
} from '@/server/validators/customer'

/**
 * 顧客のフォーム送信を受けるサーバー側の処理。
 *
 * **組織スコープは各関数の中で requireOrganization() から取る。**
 * 画面側で取った値を引数で渡す作りにしてはいけない。Server Function は
 * 画面を経由せず直接 POST できるので、引数を差し替えるだけで
 * 他組織のデータを操作できてしまう(AGENTS.md の必須規約)。
 *
 * redirect() は NEXT_REDIRECT 例外を投げるので、try/catch の外で呼ぶ。
 * 中で呼ぶと catch が握りつぶし、保存は成功しているのに
 * 「失敗しました」と表示されて二重登録につながる。
 */

export type FormState = {
  errors?: Record<string, string>
  /** 検証に失敗したときの入力値。画面が defaultValue に戻すために使う */
  values?: CustomerFormValues
  message?: string
} | null

function collectErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !errors[key]) errors[key] = issue.message
  }
  return errors
}

/**
 * 閲覧のみのユーザーには例外ではなくメッセージを返す。
 * 例外にすると本番ではエラー画面に落ち、内容が伏せられて理由が伝わらない。
 */
function denyIfReadOnly(active: ActiveOrganization): FormState {
  if (canWrite(active.role)) return null
  return { message: 'この操作を行う権限がありません(閲覧のみのユーザーです)' }
}

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const active = await requireOrganization()
  const denied = denyIfReadOnly(active)
  if (denied) return denied

  const parsed = customerInputFromFormData(formData)
  if (!parsed.success) {
    return { errors: collectErrors(parsed.error.issues), values: formValuesFromFormData(formData) }
  }

  const created = await createCustomer(active, parsed.data)
  revalidatePath('/customers')
  redirect(`/customers/${created.id}`)
}

export async function updateCustomerAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const active = await requireOrganization()
  const denied = denyIfReadOnly(active)
  if (denied) return denied

  const parsed = customerInputFromFormData(formData)
  if (!parsed.success) {
    return { errors: collectErrors(parsed.error.issues), values: formValuesFromFormData(formData) }
  }

  const result = await updateCustomer(active, id, parsed.data)
  if (!result.ok) {
    return {
      message: '顧客が見つかりませんでした。削除された可能性があります。',
      values: formValuesFromFormData(formData),
    }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { message: '保存しました' }
}

export async function deleteCustomerAction(id: string, _prev: FormState): Promise<FormState> {
  const active = await requireOrganization()
  const denied = denyIfReadOnly(active)
  if (denied) return denied

  const result = await deleteCustomer(active, id)
  if (!result.ok) {
    if (result.reason === 'HAS_PROJECTS') {
      return {
        message: `この顧客には案件が${result.projectCount}件あるため削除できません。先に案件を削除するか、別の顧客に付け替えてください。`,
      }
    }
    return { message: '顧客が見つかりませんでした。すでに削除された可能性があります。' }
  }

  revalidatePath('/customers')
  redirect('/customers')
}
