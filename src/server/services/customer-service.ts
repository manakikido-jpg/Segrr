import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { assertCanWrite, type ActiveOrganization } from '@/server/auth/types'
import type { CustomerInput } from '@/server/validators/customer'

/**
 * 顧客のCRUD。
 *
 * **すべての関数が第1引数に ActiveOrganization を取る。** これは
 * `requireOrganization()` の戻り値で、セッション由来の組織スコープ。
 * リクエストボディから organizationId を受け取らないための決まりごと(AGENTS.md)。
 *
 * 単体取得に findUnique を使わないこと。`findUnique({ where: { id } })` だと
 * 他組織の顧客が引けてしまう。必ず organizationId を条件に含める。
 */

export type CustomerSort = 'name' | 'updated'

export async function listCustomers(
  active: ActiveOrganization,
  options: { query?: string; sort?: CustomerSort } = {},
) {
  const query = options.query?.trim()
  return db.customer.findMany({
    where: {
      organizationId: active.organizationId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { contactName: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: options.sort === 'updated' ? { updatedAt: 'desc' } : { name: 'asc' },
    select: {
      id: true,
      name: true,
      contactName: true,
      invoiceRegistrationNumber: true,
      updatedAt: true,
      _count: { select: { projects: true } },
    },
  })
}

export async function getCustomer(active: ActiveOrganization, id: string) {
  return db.customer.findFirst({
    where: { id, organizationId: active.organizationId },
    include: { _count: { select: { projects: true } } },
  })
}

export async function createCustomer(active: ActiveOrganization, input: CustomerInput) {
  assertCanWrite(active)
  return db.customer.create({
    data: { ...input, organizationId: active.organizationId },
    select: { id: true },
  })
}

/**
 * 更新。組織が一致する行だけを対象にする。
 * updateMany を使うのは、where に organizationId を含めたいため
 * (update は主キーしか指定できず、他組織の行を更新できてしまう)。
 */
export async function updateCustomer(
  active: ActiveOrganization,
  id: string,
  input: CustomerInput,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }> {
  assertCanWrite(active)
  const result = await db.customer.updateMany({
    where: { id, organizationId: active.organizationId },
    data: input,
  })
  return result.count === 0 ? { ok: false, reason: 'NOT_FOUND' } : { ok: true }
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'HAS_PROJECTS'; projectCount: number }

/**
 * 削除。案件を持つ顧客は削除できない(Customer → Project の外部キーが Restrict)。
 *
 * 外部キー違反の生の例外をユーザーに見せないよう、事前に件数を数えて理由を返す。
 * 数えてから削除するまでの間に案件が増える可能性は残るが、その場合も
 * DB が最終的に弾く(削除が成功して案件が孤立することはない)。
 */
export async function deleteCustomer(
  active: ActiveOrganization,
  id: string,
): Promise<DeleteResult> {
  assertCanWrite(active)

  const customer = await db.customer.findFirst({
    where: { id, organizationId: active.organizationId },
    select: { id: true, _count: { select: { projects: true } } },
  })
  if (!customer) return { ok: false, reason: 'NOT_FOUND' }
  if (customer._count.projects > 0) {
    return { ok: false, reason: 'HAS_PROJECTS', projectCount: customer._count.projects }
  }

  try {
    const result = await db.customer.deleteMany({
      where: { id, organizationId: active.organizationId },
    })
    return result.count === 0 ? { ok: false, reason: 'NOT_FOUND' } : { ok: true }
  } catch (e) {
    // 件数を数えてから削除するまでの間に案件が作られた場合。
    // 外部キー違反(P2003)の生の例外をユーザーに見せないよう、理由に変換する
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      const projectCount = await db.project.count({
        where: { customerId: id, organizationId: active.organizationId },
      })
      return { ok: false, reason: 'HAS_PROJECTS', projectCount }
    }
    throw e
  }
}
