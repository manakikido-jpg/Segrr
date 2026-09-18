import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.js'

/**
 * 顧客管理の画面が実際に動くかを確認する(B2の完了条件)。
 *   npm run smoke
 *
 * Google ログインは自動化できないため、Auth.js のデータベースセッション方式を利用し、
 * Session 行を直接作ってその Cookie をブラウザに載せる。認証の判定そのものは
 * tests/unit/auth-invitation.test.ts が担当しており、ここでは画面の動作を見る。
 */
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'
const run = randomUUID().slice(0, 8)
const steps = []
const check = (label, ok, detail = '') => {
  steps.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const org = await db.organization.create({ data: { name: `スモークテスト-${run}` } })
  const user = await db.user.create({ data: { email: `smoke-${run}@example.test`, name: 'スモーク' } })
  await db.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } })
  const sessionToken = randomUUID()
  await db.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 3600_000) },
  })

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox'],
  })
  const context = await browser.newContext()
  await context.addCookies([
    { name: 'authjs.session-token', value: sessionToken, url: BASE, httpOnly: true, sameSite: 'Lax' },
  ])
  const page = await context.newPage()

  try {
    // 一覧: 最初は空
    await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' })
    check('顧客一覧が開ける', await page.getByRole('heading', { name: '顧客' }).isVisible())
    check('顧客ゼロの空状態が出る', await page.getByText('顧客がまだありません').isVisible())

    // 作成: 検証エラー(顧客名が空)
    await page.goto(`${BASE}/customers/new`, { waitUntil: 'networkidle' })
    await page.fill('#contactName', '山田 太郎')
    await page.fill('#invoiceRegistrationNumber', 'Ｔ１２３')  // 全角かつ桁不足
    await page.getByRole('button', { name: '登録する' }).click()
    await page.waitForTimeout(1200)
    check('顧客名が空だとエラーが出る', await page.getByText('顧客名を入力してください').isVisible())
    check(
      '登録番号の形式エラーが出る',
      await page.getByText(/登録番号は T のあとに数字13桁/).isVisible(),
    )
    check(
      'エラー時に入力値が消えない',
      (await page.inputValue('#contactName')) === '山田 太郎',
      `担当者名 = "${await page.inputValue('#contactName')}"`,
    )

    // 作成: 成功
    await page.fill('#name', '株式会社スモーク')
    await page.fill('#invoiceRegistrationNumber', 'Ｔ１２３４５６７８９０１２３')  // 全角で入力
    await page.selectOption('#honorific', '御中')
    await page.selectOption('#closingDay', '31')
    await page.selectOption('#paymentMonthOffset', '1')
    await page.selectOption('#paymentDay', '31')
    await page.getByRole('button', { name: '登録する' }).click()
    // /customers/new も正規表現に一致してしまうので、明示的に除外する
    await page.waitForURL((url) => /\/customers\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), { timeout: 15000 })
    check('登録すると詳細画面へ遷移する', true, page.url().replace(BASE, ''))

    const created = await db.customer.findFirstOrThrow({ where: { organizationId: org.id } })
    check('全角で入力した登録番号が半角で保存される', created.invoiceRegistrationNumber === 'T1234567890123',
      String(created.invoiceRegistrationNumber))
    check('請求条件が保存される',
      created.closingDay === 31 && created.paymentMonthOffset === 1 && created.paymentDay === 31)

    // 更新
    await page.fill('#name', '株式会社スモーク(改)')
    await page.selectOption('#honorific', '様')
    await page.getByRole('button', { name: '保存する' }).click()
    await page.waitForTimeout(1500)
    check('保存メッセージが出る', await page.getByText('保存しました').isVisible())
    const updated = await db.customer.findUniqueOrThrow({ where: { id: created.id } })
    check('更新が反映される', updated.name === '株式会社スモーク(改)' && updated.honorific === '様')

    // 一覧に出る
    await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' })
    check('一覧に表示される', await page.getByRole('link', { name: '株式会社スモーク(改)' }).isVisible())

    // 検索
    await page.fill('input[name="q"]', 'スモーク')
    await page.getByRole('button', { name: '絞り込む' }).click()
    await page.waitForTimeout(1000)
    check('検索で絞り込める', await page.getByRole('link', { name: '株式会社スモーク(改)' }).isVisible())
    await page.goto(`${BASE}/customers?q=該当しない語`, { waitUntil: 'networkidle' })
    check('該当なしの空状態が出る', await page.getByText('該当する顧客がありません').isVisible())

    // 案件がある顧客は削除できない
    await db.project.create({
      data: { organizationId: org.id, customerId: created.id, name: 'スモーク案件' },
    })
    await page.goto(`${BASE}/customers/${created.id}`, { waitUntil: 'networkidle' })
    check('案件があると削除できない理由が出る',
      await page.getByText(/案件が1件ひもづいています/).isVisible())

    // 案件を消してから削除
    await db.project.deleteMany({ where: { customerId: created.id } })
    await page.goto(`${BASE}/customers/${created.id}`, { waitUntil: 'networkidle' })
    page.on('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'この顧客を削除' }).click()
    await page.waitForURL(`${BASE}/customers`, { timeout: 15000 })
    check('削除すると一覧へ戻る', true)
    check('削除が反映される', (await db.customer.count({ where: { id: created.id } })) === 0)

    // 他組織の顧客は見えない
    const otherOrg = await db.organization.create({ data: { name: `別組織-${run}` } })
    const otherCustomer = await db.customer.create({
      data: { organizationId: otherOrg.id, name: '別組織の顧客' },
    })
    const res = await page.goto(`${BASE}/customers/${otherCustomer.id}`, { waitUntil: 'networkidle' })
    check('他組織の顧客を開くと404になる', res?.status() === 404, `HTTP ${res?.status()}`)

    await db.customer.deleteMany({ where: { organizationId: otherOrg.id } })
    await db.organization.delete({ where: { id: otherOrg.id } })
  } finally {
    await browser.close()
    await db.project.deleteMany({ where: { organizationId: org.id } })
    await db.customer.deleteMany({ where: { organizationId: org.id } })
    await db.session.deleteMany({ where: { userId: user.id } })
    await db.membership.deleteMany({ where: { userId: user.id } })
    await db.organization.delete({ where: { id: org.id } })
    await db.user.delete({ where: { id: user.id } })
    await db.$disconnect()
  }

  const failed = steps.filter((s) => !s.ok)
  console.log(`\n合格 ${steps.length - failed.length} / ${steps.length}`)
  if (failed.length > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
