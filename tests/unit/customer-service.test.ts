import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import type { ActiveOrganization } from '@/server/auth/types'
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from '@/server/services/customer-service'
import type { CustomerInput } from '@/server/validators/customer'

/**
 * 顧客サービスのテナント境界を実DBに対して固定する。
 *
 * 「他組織の顧客を読み書きできない」ことが、このアプリで最も守りたい性質。
 * findUnique を使うなどの実装ミスで境界が抜けても、ここで落ちる。
 */
const connectionString = process.env.DATABASE_URL
const suite = connectionString ? describe : describe.skip

suite('顧客サービス', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) })
  const run = Math.random().toString(36).slice(2, 10)
  const orgIds: string[] = []

  async function makeOrg(name: string, role: ActiveOrganization['role'] = 'OWNER') {
    const org = await db.organization.create({ data: { name: `${name}-${run}` } })
    orgIds.push(org.id)
    return {
      userId: `user-${run}`,
      organizationId: org.id,
      role,
      organizationName: org.name,
    } satisfies ActiveOrganization
  }

  const input = (name: string): CustomerInput => ({
    name,
    contactName: null, email: null, phone: null, postalCode: null, address: null, notes: null,
    invoiceRegistrationNumber: null,
    closingDay: null, paymentMonthOffset: 1, paymentDay: null,
    withholdingDefault: false,
    honorific: '御中',
  })

  afterEach(async () => {
    const ids = orgIds.splice(0)
    await db.project.deleteMany({ where: { organizationId: { in: ids } } })
    await db.customer.deleteMany({ where: { organizationId: { in: ids } } })
    await db.organization.deleteMany({ where: { id: { in: ids } } })
  })
  afterAll(() => db.$disconnect())

  describe('テナント境界', () => {
    it('一覧には自分の組織の顧客しか出ない', async () => {
      const a = await makeOrg('org-a')
      const b = await makeOrg('org-b')
      await createCustomer(a, input('Aの顧客'))
      await createCustomer(b, input('Bの顧客'))

      expect((await listCustomers(a)).map((c) => c.name)).toEqual(['Aの顧客'])
      expect((await listCustomers(b)).map((c) => c.name)).toEqual(['Bの顧客'])
    })

    it('他組織の顧客はIDを知っていても取得できない', async () => {
      const a = await makeOrg('org-a')
      const b = await makeOrg('org-b')
      const created = await createCustomer(a, input('Aの顧客'))

      expect(await getCustomer(a, created.id)).not.toBeNull()
      expect(await getCustomer(b, created.id)).toBeNull()
    })

    it('他組織の顧客は更新できない', async () => {
      const a = await makeOrg('org-a')
      const b = await makeOrg('org-b')
      const created = await createCustomer(a, input('元の名前'))

      expect(await updateCustomer(b, created.id, input('乗っ取り'))).toEqual({
        ok: false,
        reason: 'NOT_FOUND',
      })
      const after = await getCustomer(a, created.id)
      expect(after?.name).toBe('元の名前')
    })

    it('他組織の顧客は削除できない', async () => {
      const a = await makeOrg('org-a')
      const b = await makeOrg('org-b')
      const created = await createCustomer(a, input('消されたくない'))

      expect(await deleteCustomer(b, created.id)).toEqual({ ok: false, reason: 'NOT_FOUND' })
      expect(await getCustomer(a, created.id)).not.toBeNull()
    })
  })

  describe('CRUD', () => {
    it('作成 → 一覧 → 更新 → 削除 が一通り通る(B2の完了条件)', async () => {
      const a = await makeOrg('org')
      const created = await createCustomer(a, input('株式会社テスト'))

      expect((await listCustomers(a)).map((c) => c.name)).toEqual(['株式会社テスト'])

      expect(await updateCustomer(a, created.id, { ...input('株式会社テスト(改)'), closingDay: 31 })).toEqual({ ok: true })
      const updated = await getCustomer(a, created.id)
      expect(updated?.name).toBe('株式会社テスト(改)')
      expect(updated?.closingDay).toBe(31)

      expect(await deleteCustomer(a, created.id)).toEqual({ ok: true })
      expect(await listCustomers(a)).toEqual([])
    })

    it('検索は顧客名・担当者名・メールに効き、大文字小文字を区別しない', async () => {
      const a = await makeOrg('org')
      await createCustomer(a, { ...input('株式会社アルファ'), contactName: '山田太郎', email: 'yamada@example.com' })
      await createCustomer(a, input('株式会社ベータ'))

      expect((await listCustomers(a, { query: 'アルファ' })).length).toBe(1)
      expect((await listCustomers(a, { query: '山田' })).length).toBe(1)
      expect((await listCustomers(a, { query: 'YAMADA@EXAMPLE.COM' })).length).toBe(1)
      expect((await listCustomers(a, { query: '該当なし' })).length).toBe(0)
    })

    it('案件を持つ顧客は削除できず、件数を添えて理由を返す', async () => {
      const a = await makeOrg('org')
      const created = await createCustomer(a, input('案件あり'))
      await db.project.create({
        data: { organizationId: a.organizationId, customerId: created.id, name: '案件1' },
      })

      expect(await deleteCustomer(a, created.id)).toEqual({
        ok: false,
        reason: 'HAS_PROJECTS',
        projectCount: 1,
      })
      expect(await getCustomer(a, created.id)).not.toBeNull()
    })
  })

  describe('権限', () => {
    it('VIEWER は作成・更新・削除ができない', async () => {
      const viewer = await makeOrg('org-viewer', 'VIEWER')
      await expect(createCustomer(viewer, input('だめ'))).rejects.toThrow(/権限がありません/)
      await expect(updateCustomer(viewer, 'x', input('だめ'))).rejects.toThrow(/権限がありません/)
      await expect(deleteCustomer(viewer, 'x')).rejects.toThrow(/権限がありません/)
    })

    it('VIEWER でも一覧は見られる', async () => {
      const owner = await makeOrg('org-shared')
      await createCustomer(owner, input('共有の顧客'))
      const viewer: ActiveOrganization = { ...owner, role: 'VIEWER' }
      expect((await listCustomers(viewer)).map((c) => c.name)).toEqual(['共有の顧客'])
    })
  })
})
