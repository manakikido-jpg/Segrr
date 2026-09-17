import { afterAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import fixture from '../fixtures/tax-cases.json'

/**
 * src/lib/tax.ts の計算が、DBトリガー(docs/db-constraints.sql)の算出と
 * 一致することを実DBに対して確認する。
 *
 * tax.ts はUIプレビュー専用で、保存される金額はDBが決める。両者が1円でもずれると
 * 「画面の金額と発行済みPDFの金額が違う」事故になるため、同じフィクスチャを
 * 両側に流して突き合わせる。
 *
 * DATABASE_URL が無い環境ではスキップする(CIでDBを立てない場合を想定)。
 * 投入したデータはトランザクションごと破棄するので、開発用DBに残らない。
 */
const connectionString = process.env.DATABASE_URL
const suite = connectionString ? describe : describe.skip

const ROLLBACK = 'ROLLBACK_AFTER_ASSERTIONS'

suite('DBトリガーとの一致', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) })
  afterAll(() => db.$disconnect())

  /** 投入 → トリガー算出を読み出し → 例外でロールバック、を1件ぶん行う。 */
  async function computeInDb(
    items: readonly { quantity: number; unitPrice: number; taxRate: number }[],
    rounding: string,
  ) {
    let captured: Record<string, number> | undefined
    try {
      await db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: 'tax-parity', taxRounding: rounding as 'FLOOR' | 'ROUND' | 'CEIL' },
        })
        const customer = await tx.customer.create({
          data: { organizationId: org.id, name: 'tax-parity' },
        })
        const project = await tx.project.create({
          data: { organizationId: org.id, customerId: customer.id, name: 'tax-parity' },
        })
        const quote = await tx.quote.create({
          data: {
            organizationId: org.id,
            projectId: project.id,
            number: `EST-PARITY-${Math.random().toString(36).slice(2, 10)}`,
            items: {
              create: items.map((it, i) => ({
                name: `明細${i + 1}`,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                taxRate: it.taxRate,
                sortOrder: i,
              })),
            },
          },
        })
        const saved = await tx.quote.findUniqueOrThrow({ where: { id: quote.id } })
        captured = {
          subtotal10: saved.subtotal10,
          tax10: saved.tax10,
          subtotal8: saved.subtotal8,
          tax8: saved.tax8,
          subtotal: saved.subtotal,
          taxAmount: saved.taxAmount,
          totalAmount: saved.totalAmount,
        }
        throw new Error(ROLLBACK)
      })
    } catch (e) {
      if (!(e instanceof Error) || e.message !== ROLLBACK) throw e
    }
    return captured
  }

  for (const c of fixture.taxCases) {
    it(`DBの算出も一致: ${c.name}`, async () => {
      expect(await computeInDb(c.items, c.rounding)).toEqual(c.expected)
    })
  }

  for (const c of fixture.withholdingCases) {
    it(`DBの源泉徴収も一致: 税抜 ${c.base.toLocaleString('ja-JP')}円`, async () => {
      const rows = await db.$queryRaw<
        { v: number }[]
      >`SELECT segrr_withholding_tax(${c.base}::integer) AS v`
      expect(rows[0]?.v).toBe(c.expected)
    })
  }
})
