import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

/**
 * 開発用シード。
 *   npm run db:seed
 *
 * 要件定義書セクション2の「Phase 0 は組織=本人+テスターの固定運用」に沿って、
 * 招待UIは作らずここで招待を投入する。
 *
 * **組織を2つ作る。** 1つだけだと「互いのデータが見えない」ことを確認できないため
 * (B1の完了条件)。2つ目は別アカウントを OWNER にした検証用。
 */

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL が未設定です')

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase()
const TESTER_EMAIL = process.env.SEED_TESTER_EMAIL?.trim().toLowerCase()
const OTHER_EMAIL = process.env.SEED_OTHER_ORG_EMAIL?.trim().toLowerCase()

/** 招待の有効期限。Phase 0 は長めに取る(招待UIが無く再発行できないため)。 */
const EXPIRES_AT = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

async function upsertOrganization(name: string, extra: Record<string, unknown> = {}) {
  const existing = await db.organization.findFirst({ where: { name } })
  if (existing) return existing
  return db.organization.create({ data: { name, ...extra } })
}

async function invite(organizationId: string, email: string | undefined, role: 'OWNER' | 'MEMBER') {
  if (!email) return null
  await db.invitation.upsert({
    where: { organizationId_email: { organizationId, email } },
    create: { organizationId, email, role, expiresAt: EXPIRES_AT },
    update: { role, expiresAt: EXPIRES_AT },
  })
  return email
}

async function main() {
  if (!OWNER_EMAIL) {
    throw new Error(
      'SEED_OWNER_EMAIL が未設定です。.env にご自身のGoogleアカウントのメールアドレスを入れてください',
    )
  }

  // ── 本番運用する組織 ──
  const main = await upsertOrganization('木戸事務所', {
    // 帳票に印字する自社情報。実際の値は設定画面(B系)から入力する
    defaultTaxRate: 10,
    taxRounding: 'FLOOR',
  })
  await invite(main.id, OWNER_EMAIL, 'OWNER')
  const tester = await invite(main.id, TESTER_EMAIL, 'MEMBER')

  // ── テナント分離の確認用(別組織) ──
  const other = await upsertOrganization('検証用の別組織')
  const otherOwner = await invite(other.id, OTHER_EMAIL, 'OWNER')

  // .env から外したアドレスの招待は消す。残しておくと、使わなくなったアドレスで
  // ログインできてしまう。シードは「あるべき状態」を宣言するものとして扱う。
  // 既に参加した人の Membership は消さない(招待は入場券であって会員証ではない)
  for (const [org, keep] of [
    [main, [OWNER_EMAIL, TESTER_EMAIL]],
    [other, [OTHER_EMAIL]],
  ] as const) {
    const stale = await db.invitation.deleteMany({
      where: {
        organizationId: org.id,
        email: { notIn: keep.filter((e): e is string => Boolean(e)) },
      },
    })
    if (stale.count > 0) {
      console.log(`  ${org.name}: 不要になった招待を${stale.count}件削除しました`)
    }
  }

  // 組織ごとに顧客を1件ずつ作り、組織をまたいで見えないことを確認できるようにする
  for (const [org, customerName] of [
    [main, '株式会社サンプル商事'],
    [other, '別組織の顧客(見えてはいけない)'],
  ] as const) {
    const exists = await db.customer.findFirst({
      where: { organizationId: org.id, name: customerName },
    })
    if (!exists) {
      await db.customer.create({ data: { organizationId: org.id, name: customerName } })
    }
  }

  console.log('シードを投入しました')
  console.log(`  ${main.name}`)
  console.log(`    OWNER  : ${OWNER_EMAIL}`)
  console.log(`    MEMBER : ${tester ?? '(SEED_TESTER_EMAIL 未設定のためスキップ)'}`)
  console.log(`  ${other.name}`)
  console.log(`    OWNER  : ${otherOwner ?? '(SEED_OTHER_ORG_EMAIL 未設定のためスキップ)'}`)
  console.log('')
  console.log('招待されていないアカウントではログインできません。')
  console.log('Google Cloud Console のテストユーザーにも同じアドレスを登録してください。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
