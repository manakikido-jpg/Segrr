import type { MembershipRole } from '@/generated/prisma/client'

/**
 * 組織スコープの型と権限判定。
 *
 * **Next.js に依存しないモジュールとして切り出してある。** サービス層がここを参照し、
 * session.ts(next/navigation や Auth.js を読み込む)を参照しないようにするため。
 * サービス層が Next に依存すると、ユニットテストから読み込めなくなる。
 */

export type ActiveOrganization = {
  userId: string
  organizationId: string
  role: MembershipRole
  organizationName: string
}

/**
 * 書き込み権限があるか。VIEWER は読み取りのみ。
 *
 * Phase 0 ではロールを付け替えるUIは作らない(シードで固定)。
 * 権限UIを作り込むとスコープが膨らむため(要件定義書セクション5・失敗パターン11)。
 */
export function canWrite(role: MembershipRole): boolean {
  return role === 'OWNER' || role === 'MEMBER'
}

/** 書き込みが必要な処理で使う。VIEWER なら例外にする。 */
export function assertCanWrite(active: ActiveOrganization): void {
  if (!canWrite(active.role)) {
    throw new Error('この操作を行う権限がありません(閲覧のみのユーザーです)')
  }
}
