import { cache } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ensureMemberships } from '@/server/auth/invitation'
import type { ActiveOrganization } from '@/server/auth/types'

export { canWrite, assertCanWrite } from '@/server/auth/types'
export type { ActiveOrganization } from '@/server/auth/types'

/**
 * 認可の集約点(Next.js のガイドが言う Data Access Layer)。
 *
 * **サービス層・Route Handler・Server Component は、必ずここを経由して organizationId を得る。**
 * リクエストボディやクエリパラメータから organizationId を受け取ってはいけない。
 * テナント越えの読み書きを防ぐ、このプロジェクトで最も重要な規約。
 *
 * organizationId をセッションに載せないのは、載せるとクライアントが持つ値を認可の
 * スコープとして信用することになるため。所属が変わってもセッションを作り直すまで
 * 古い組織のまま操作できてしまう。代わりにリクエストごとにDBから引き、
 * React の cache() で1回のレンダリング内は1クエリに抑える。
 *
 * Phase 0 は「1ユーザー1組織」の固定運用(要件定義書セクション2)。複数組織に
 * 所属した場合は作成順で最初の1つを使う。組織切り替えUIは Phase 3。
 */

/** ログイン済みのユーザー。未ログインなら null。 */
export const getCurrentUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const session = await auth()
    const user = session?.user
    if (!user?.id) return null
    return { id: user.id, email: user.email ?? null }
  },
)

/** ログイン済みのユーザーID。未ログインなら null。 */
export async function getCurrentUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null
}

/**
 * 現在のユーザーが所属する組織。複数所属している場合は最初の1つを使う
 * (Phase 0 は「組織=本人+テスター」の固定運用。組織切り替えUIは Phase 3)。
 */
export const getActiveOrganization = cache(async (): Promise<ActiveOrganization | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  const userId = user.id

  const findMembership = () =>
    db.membership.findFirst({
      where: { userId },
      // 作成順で決める。同時作成でも順序がぶれないよう id で二段目の順序を付ける
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        organizationId: true,
        role: true,
        organization: { select: { name: true } },
      },
    })

  let membership = await findMembership()

  // 遅延承諾。Membership がまだ無い場合だけ、有効な招待から作る。
  // signIn コールバックの時点では User レコードが存在しないため、ここで行う。
  if (!membership && user.email) {
    const created = await ensureMemberships({ userId, email: user.email })
    if (created.length > 0) membership = await findMembership()
  }

  if (!membership) return null

  return {
    userId,
    organizationId: membership.organizationId,
    role: membership.role,
    organizationName: membership.organization.name,
  }
})

/** ログイン必須のページ・ハンドラで使う。未ログインならログイン画面へ送る。 */
export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')
  return userId
}

/**
 * 組織スコープが必要なすべての処理で使う。
 * ログイン済みだが所属組織が無い場合は、ログイン画面にその旨を出して止める
 * (招待が取り消された、Membership の作成に失敗した、などのケース)。
 */
export async function requireOrganization(): Promise<ActiveOrganization> {
  const active = await getActiveOrganization()
  if (!active) {
    const userId = await getCurrentUserId()
    // ログイン済みなのに組織が無い場合(招待の取り消しなど)。ログイン画面は
    // proxy の対象外なので、ここへ送ってもリダイレクトループにはならない。
    // ログイン画面側でログアウトの導線を出して、別アカウントへ移れるようにする。
    redirect(userId ? '/login?error=no-organization' : '/login')
  }
  return active
}


