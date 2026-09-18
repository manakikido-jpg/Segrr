import { db } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'

/**
 * 招待制の判定と Membership の同期。
 *
 * Auth.js のコールバックから切り出してある。コールバックの中に置くと実DBに対して
 * テストできないため(招待制はこのアプリの入口の鍵なので、抜け道が無いことを
 * テストで固定したい)。
 *
 * **招待は「入場券」であって「会員証」ではない。** 一度参加した人は Membership で
 * 判断し、招待の期限や承諾状態には左右されない。これを混同すると、招待の期限が
 * 切れた時点で既存メンバー全員が締め出される。
 */

/** メールアドレスの照合は小文字に揃える。Google 側の表記ゆれとシードの入力ゆれを吸収する。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type DenyReason =
  | 'no-email'
  | 'email-unverified'
  | 'not-invited'
  | 'invitation-expired'

export type SignInDecision = { allowed: true } | { allowed: false; reason: DenyReason }

/**
 * このメールアドレスでログインしてよいか。
 *
 * 判定は2段:
 *   1. 既に Membership を持っている → 招待の状態に関係なく許可(既存メンバー)
 *   2. 有効な招待がある → 許可(初回参加)
 *
 * `emailVerified` は Google 側でメールアドレスが確認済みかどうか。未確認を許すと、
 * 独自ドメインのアドレスを未確認のまま登録した別の Google アカウントで
 * 招待を横取りできてしまう。**明示的に true でなければ拒否する。**
 */
export async function resolveSignIn(
  args: { email: string | null | undefined; emailVerified: boolean | undefined },
  client: PrismaClient = db,
): Promise<SignInDecision> {
  if (!args.email) return { allowed: false, reason: 'no-email' }
  if (args.emailVerified !== true) return { allowed: false, reason: 'email-unverified' }

  const email = normalizeEmail(args.email)

  // 1. 既存メンバーか
  const member = await client.user.findFirst({
    where: { email, memberships: { some: {} } },
    select: { id: true },
  })
  if (member) return { allowed: true }

  // 2. 有効な招待があるか
  const invitations = await client.invitation.findMany({
    where: { email },
    select: { expiresAt: true },
  })
  if (invitations.length === 0) return { allowed: false, reason: 'not-invited' }

  const now = Date.now()
  if (!invitations.some((i) => i.expiresAt.getTime() > now)) {
    return { allowed: false, reason: 'invitation-expired' }
  }
  return { allowed: true }
}

/**
 * 有効な招待に対応する Membership を用意する(遅延承諾)。
 *
 * Auth.js のコールバックではなく、組織を引くときに呼ぶ。理由:
 *  - `signIn` コールバックの時点では User レコードがまだ存在しない
 *    (Auth.js は signIn コールバックを adapter.createUser より前に呼ぶ)
 *  - `events.signIn` で作ると、例外時にセッション行だけ残った半端な状態になりうる
 *  - 既存ユーザーを後から別組織に招待した場合も、次のアクセスで自動的に揃う
 *
 * 冪等。`@@unique([organizationId, userId])` があるので二重作成は起きない。
 *
 * @returns 作成または確認した organizationId の一覧
 */
export async function ensureMemberships(
  args: { userId: string; email: string },
  client: PrismaClient = db,
): Promise<string[]> {
  const invitations = await client.invitation.findMany({
    where: { email: normalizeEmail(args.email), expiresAt: { gt: new Date() } },
    select: { id: true, organizationId: true, role: true },
  })
  if (invitations.length === 0) return []

  const organizationIds: string[] = []
  for (const invitation of invitations) {
    await client.$transaction([
      client.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: args.userId,
          },
        },
        create: {
          organizationId: invitation.organizationId,
          userId: args.userId,
          role: invitation.role,
        },
        // 既存の Membership のロールは上書きしない。運用中に変更したロールが、
        // 招待側に残った古い値で巻き戻ると事故になる
        update: {},
      }),
      client.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ])
    organizationIds.push(invitation.organizationId)
  }
  return organizationIds
}
