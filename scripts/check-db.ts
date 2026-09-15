import 'dotenv/config'
/**
 * DB接続の疎通確認(タスクA1の完了条件)。
 *   npm run db:check
 * マイグレーションが適用され、トリガーが動く状態かどうかまで見る。
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL が未設定です')

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function main() {
  const [{ version }] = await db.$queryRaw<{ version: string }[]>`SELECT version()`
  console.log('接続先:', version.split(',')[0])

  const applied = await db.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations"
     WHERE finished_at IS NOT NULL ORDER BY finished_at`
  console.log('適用済みマイグレーション:', applied.map((m) => m.migration_name).join(', '))

  const triggers = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal`
  console.log('DBトリガー:', Number(triggers[0]!.count), '個')

  // 書き込み → トリガーによる自動算出 → 後片付け、まで一周させる
  const org = await db.organization.create({ data: { name: '疎通確認用' } })
  const customer = await db.customer.create({
    data: { organizationId: org.id, name: '疎通確認用の顧客' },
  })
  const project = await db.project.create({
    data: { organizationId: org.id, customerId: customer.id, name: '疎通確認用の案件' },
  })
  const quote = await db.quote.create({
    data: {
      organizationId: org.id,
      projectId: project.id,
      number: 'EST-CHECK',
      items: { create: [{ name: '確認用', quantity: 2, unitPrice: 500, taxRate: 10 }] },
    },
  })
  const saved = await db.quote.findUniqueOrThrow({ where: { id: quote.id } })
  console.log(
    `トリガー算出: 税抜 ${saved.subtotal} / 消費税 ${saved.taxAmount} / 税込 ${saved.totalAmount}`,
  )
  if (saved.subtotal !== 1000 || saved.taxAmount !== 100 || saved.totalAmount !== 1100) {
    throw new Error('金額の自動算出が期待と異なります。マイグレーションの適用漏れの可能性があります')
  }

  await db.quote.delete({ where: { id: quote.id } })
  await db.project.delete({ where: { id: project.id } })
  await db.customer.delete({ where: { id: customer.id } })
  await db.organization.delete({ where: { id: org.id } })
  console.log('OK: 接続・書き込み・トリガー算出・削除まで確認できました')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
