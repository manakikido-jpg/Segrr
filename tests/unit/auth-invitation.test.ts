import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { ensureMemberships, normalizeEmail, resolveSignIn } from '@/server/auth/invitation'

/**
 * 招待制に抜け道が無いことを実DBに対して固定する。
 *
 * 実際の Google ログインは自動テストできないが、「誰を入れて誰を弾くか」の判定は
 * すべてここに集約してあるので、入口の鍵はこのテストで守れる。
 *
 * DATABASE_URL が無い環境ではスキップする。
 */
const connectionString = process.env.DATABASE_URL
const suite = connectionString ? describe : describe.skip

suite('招待制', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) })

  // 並行実行や開発用データと衝突しないよう、実行ごとに一意な接頭辞を使う
  const run = Math.random().toString(36).slice(2, 10)
  const mail = (local: string) => `${local}+${run}@example.test`
  const createdOrgIds: string[] = []
  const createdUserIds: string[] = []

  async function makeOrg(name: string) {
    const org = await db.organization.create({ data: { name: `${name}-${run}` } })
    createdOrgIds.push(org.id)
    return org
  }

  async function makeUser(email: string) {
    const user = await db.user.create({ data: { email: normalizeEmail(email) } })
    createdUserIds.push(user.id)
    return user
  }

  const future = () => new Date(Date.now() + 60 * 60 * 1000)
  const past = () => new Date(Date.now() - 60 * 60 * 1000)

  afterEach(async () => {
    const orgIds = createdOrgIds.splice(0)
    // Customer は組織への参照が Restrict なので先に消す(顧客を持つ組織は削除できない)。
    // Membership と Invitation は Organization のカスケードで消える
    await db.customer.deleteMany({ where: { organizationId: { in: orgIds } } })
    await db.organization.deleteMany({ where: { id: { in: orgIds } } })
    await db.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } })
  })
  afterAll(() => db.$disconnect())

  describe('resolveSignIn — 誰を入れるか', () => {
    it('招待されていないメールアドレスは拒否する', async () => {
      const r = await resolveSignIn({ email: mail('stranger'), emailVerified: true }, db)
      expect(r).toEqual({ allowed: false, reason: 'not-invited' })
    })

    it('有効な招待があれば許可する', async () => {
      const org = await makeOrg('org')
      const email = mail('invited')
      await db.invitation.create({ data: { organizationId: org.id, email, expiresAt: future() } })

      expect(await resolveSignIn({ email, emailVerified: true }, db)).toEqual({ allowed: true })
    })

    it('期限切れの招待は拒否する', async () => {
      const org = await makeOrg('org')
      const email = mail('expired')
      await db.invitation.create({ data: { organizationId: org.id, email, expiresAt: past() } })

      expect(await resolveSignIn({ email, emailVerified: true }, db)).toEqual({
        allowed: false,
        reason: 'invitation-expired',
      })
    })

    it('大文字や前後の空白があっても同じ招待として扱う', async () => {
      const org = await makeOrg('org')
      const email = mail('mixedcase')
      await db.invitation.create({
        data: { organizationId: org.id, email: normalizeEmail(email), expiresAt: future() },
      })

      const r = await resolveSignIn({ email: `  ${email.toUpperCase()}  `, emailVerified: true }, db)
      expect(r).toEqual({ allowed: true })
    })

    it('Google側でメールアドレスが未確認なら、招待があっても拒否する', async () => {
      const org = await makeOrg('org')
      const email = mail('unverified')
      await db.invitation.create({ data: { organizationId: org.id, email, expiresAt: future() } })

      expect(await resolveSignIn({ email, emailVerified: false }, db)).toEqual({
        allowed: false,
        reason: 'email-unverified',
      })
      // 値が取れなかった場合も通さない(既定で拒否)
      expect(await resolveSignIn({ email, emailVerified: undefined }, db)).toEqual({
        allowed: false,
        reason: 'email-unverified',
      })
    })

    it('メールアドレスが無ければ拒否する', async () => {
      expect(await resolveSignIn({ email: null, emailVerified: true }, db)).toEqual({
        allowed: false,
        reason: 'no-email',
      })
    })

    it('既存メンバーは招待が期限切れでも入れる(招待は入場券であって会員証ではない)', async () => {
      const org = await makeOrg('org')
      const email = mail('member')
      const user = await makeUser(email)
      await db.membership.create({ data: { organizationId: org.id, userId: user.id } })
      await db.invitation.create({
        data: { organizationId: org.id, email, expiresAt: past(), acceptedAt: new Date() },
      })

      expect(await resolveSignIn({ email, emailVerified: true }, db)).toEqual({ allowed: true })
    })

    it('Userはいるが所属組織が無い場合は、招待が無ければ拒否する', async () => {
      const email = mail('orphan')
      await makeUser(email)
      expect(await resolveSignIn({ email, emailVerified: true }, db)).toEqual({
        allowed: false,
        reason: 'not-invited',
      })
    })
  })

  describe('ensureMemberships — 遅延承諾', () => {
    it('有効な招待から Membership を作り、招待に承諾日を記録する', async () => {
      const org = await makeOrg('org')
      const email = mail('accept')
      const user = await makeUser(email)
      const inv = await db.invitation.create({
        data: { organizationId: org.id, email, role: 'MEMBER', expiresAt: future() },
      })

      const ids = await ensureMemberships({ userId: user.id, email }, db)
      expect(ids).toEqual([org.id])

      const membership = await db.membership.findFirst({ where: { userId: user.id } })
      expect(membership?.organizationId).toBe(org.id)
      expect(membership?.role).toBe('MEMBER')
      expect((await db.invitation.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt).not.toBeNull()
    })

    it('期限切れの招待からは作らない', async () => {
      const org = await makeOrg('org')
      const email = mail('stale')
      const user = await makeUser(email)
      await db.invitation.create({ data: { organizationId: org.id, email, expiresAt: past() } })

      expect(await ensureMemberships({ userId: user.id, email }, db)).toEqual([])
      expect(await db.membership.count({ where: { userId: user.id } })).toBe(0)
    })

    it('2回呼んでも二重に作らない(冪等)', async () => {
      const org = await makeOrg('org')
      const email = mail('idempotent')
      const user = await makeUser(email)
      await db.invitation.create({ data: { organizationId: org.id, email, expiresAt: future() } })

      await ensureMemberships({ userId: user.id, email }, db)
      await ensureMemberships({ userId: user.id, email }, db)
      expect(await db.membership.count({ where: { userId: user.id } })).toBe(1)
    })

    it('既存の Membership のロールを招待側の値で上書きしない', async () => {
      const org = await makeOrg('org')
      const email = mail('role')
      const user = await makeUser(email)
      await db.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } })
      await db.invitation.create({
        data: { organizationId: org.id, email, role: 'VIEWER', expiresAt: future() },
      })

      await ensureMemberships({ userId: user.id, email }, db)
      const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id } })
      expect(membership.role).toBe('OWNER')
    })

    it('複数の組織に招待されていれば、それぞれの Membership を作る', async () => {
      const a = await makeOrg('org-a')
      const b = await makeOrg('org-b')
      const email = mail('multi')
      const user = await makeUser(email)
      await db.invitation.createMany({
        data: [
          { organizationId: a.id, email, expiresAt: future() },
          { organizationId: b.id, email, expiresAt: future() },
        ],
      })

      const ids = await ensureMemberships({ userId: user.id, email }, db)
      expect(ids.sort()).toEqual([a.id, b.id].sort())
    })
  })

  describe('テナント分離', () => {
    it('組織ごとに顧客が分かれ、他組織の顧客は取得できない', async () => {
      const a = await makeOrg('tenant-a')
      const b = await makeOrg('tenant-b')
      await db.customer.create({ data: { organizationId: a.id, name: 'Aの顧客' } })
      await db.customer.create({ data: { organizationId: b.id, name: 'Bの顧客' } })

      const seenByA = await db.customer.findMany({ where: { organizationId: a.id } })
      expect(seenByA.map((c) => c.name)).toEqual(['Aの顧客'])
      expect(seenByA.some((c) => c.name === 'Bの顧客')).toBe(false)
    })
  })
})
