# Segrr

個人事業主・フリーランス向けの書類管理ツール。見積書 → 契約書 → 請求書を、
データを再入力せずに引き継いで作成・管理する。顧客管理と案件の進捗管理を含む。

- 要件定義書(このリポジトリの正): [`docs/segrr-requirements-v1.md`](docs/segrr-requirements-v1.md)
- タスク分解: [`docs/phase0-task-breakdown.md`](docs/phase0-task-breakdown.md)
- UIデザイン: [`docs/design-spec.md`](docs/design-spec.md) / キャンバスは `design/segrr-ui.dc.html`

## 技術スタック

| 領域 | 採用 |
|---|---|
| フレームワーク | Next.js (App Router) + TypeScript |
| DB | PostgreSQL + Prisma 7(ドライバアダプタ `@prisma/adapter-pg`) |
| 認証 | Auth.js v5、Google プロバイダ + 招待制 |
| スタイル | Tailwind CSS v4 + デザイントークン(`src/styles/tokens.css`) |
| テスト | Vitest(ユニット) / Playwright(E2E) / psql(DB制約) |

## セットアップ

```bash
npm install
cp .env.example .env     # 値を埋める(下表参照)
npm run db:migrate       # マイグレーション適用
npm run db:check         # 接続とトリガーの疎通確認
npm run dev              # http://localhost:3000
```

### 環境変数

| 変数 | 用途 | 取得方法 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 接続文字列 | 下記「データベースの用意」を参照 |
| `AUTH_SECRET` | Auth.js のセッション署名鍵 | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Google OAuth クライアントID | Google Cloud Console → 認証情報 → OAuth 2.0 クライアント |
| `AUTH_GOOGLE_SECRET` | 同シークレット | 同上 |

### データベースの用意

PostgreSQL 16 以降であれば動く(18 でも全テストが通ることを確認済み)。
次のどちらでもよい。

**A. クラウドの PostgreSQL(推奨。インストール不要)**

[Neon](https://neon.com) や [Supabase](https://supabase.com) でプロジェクトを作り、
表示された接続文字列をそのまま `DATABASE_URL` に貼る。SSL は追加設定なしで通る
(`sslmode=require` は証明書検証つきで解釈される)。

```
DATABASE_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require"
```

**B. ローカルにインストール**

[postgresql.org](https://www.postgresql.org/download/) から導入する。
Windows のインストーラでは、コンポーネント選択で **PostgreSQL Server** に
チェックが入っているか確認すること(Command Line Tools だけだと
`psql` は使えてもサーバーが無く、接続が拒否される)。

```
psql -U postgres -c "CREATE DATABASE segrr"
```

パスワードに `@ # / : ?` が含まれる場合は、`DATABASE_URL` の中で
パーセントエンコードが必要(`@` → `%40` など)。

### Google OAuth の設定

[Google Cloud Console](https://console.cloud.google.com/) →「Google Auth Platform」で行う。

| 左メニュー | やること |
|---|---|
| ブランディング | アプリ名・サポートメール・デベロッパー連絡先 |
| **対象** | User Type は「外部」。**テストユーザーに本人とテスターのメールアドレスを登録する** |
| **クライアント** | 種類は「ウェブ アプリケーション」。承認済みリダイレクトURIに `http://localhost:3000/api/auth/callback/google` |
| データアクセス | 触らなくてよい(email / profile / openid が既定で付く) |

公開ステータスが「テスト」の間は、**テストユーザーに登録したアカウントしか Google を通過できない**。
登録を忘れると、アプリ側の招待チェックに届く前に Google が弾く。

リダイレクトURIは1文字でも違うとログインできない(末尾スラッシュなし)。

### ログインの仕組み

**Googleログイン + 招待制。** Google で認証が通っても、`Invitation` に無いメールアドレスは
このアプリに入れない。判定は `src/server/auth/invitation.ts` に集約してあり、
`tests/unit/auth-invitation.test.ts` で抜け道が無いことを実DBに対して固定している。

- 招待は**入場券であって会員証ではない**。一度参加した人は `Membership` で判断するので、
  招待の期限が切れても締め出されない
- Google 側でメールアドレスが未確認のアカウントは拒否する
- `Membership` はログイン時ではなく、組織を引くとき(`getActiveOrganization`)に遅延して作る。
  Auth.js は `signIn` コールバックを `adapter.createUser` より前に呼ぶため、
  コールバックの時点では User レコードが存在しない
- **`organizationId` はセッションに持たせない。** 必ず `src/server/auth/session.ts` の
  `requireOrganization()` からDB経由で得る。リクエストボディからは決して受け取らない

テナント分離の確認には Google アカウントが3つ必要(本人・テスター・別組織用)。
`+alias` は Google 側で同一アカウント扱いになるため使えない。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest(ユニットテスト) |
| `npm run test:e2e` | Playwright |
| `npm run db:migrate` | マイグレーション作成・適用 + Prisma Client 再生成(開発) |
| `npm run db:deploy` | マイグレーション適用のみ(本番) |
| `npm run db:check` | DB接続・トリガー算出の疎通確認 |
| `npm run db:verify` | DB制約の検証(下記) |
| `npm run db:seed` | 開発用シード |
| `npm run db:studio` | Prisma Studio |

## 金額・消費税の扱い(重要)

**金額の正はDBにある。** 明細の `amount`、書類の合計・消費税・源泉徴収は、すべて
`docs/db-constraints.sql` のトリガーが明細から算出する。アプリからこれらのカラムを
書き込んではいけない(対象カラムの一覧は `prisma/schema.prisma` 冒頭のコメント)。

- 明細の単価は**税抜**で入力する。値引きは単価をマイナスにした明細行で表現する
- 数量は小数(`Decimal(10,2)`)。半日単位・時間単位の請求に対応する。
  `数量 × 単価` が小数になる場合はゼロ方向に切り捨てる
- 消費税の端数処理は**1書類につき税率ごとに1回**(適格請求書の要件)。明細行ごとには丸めない
- 分割請求の超過チェックは**税抜**で比較する(税込だと端数で誤判定する)
- 源泉徴収は税抜額が対象。100万円以下は 10.21%、超過分は 20.42% + 102,100円

TS側にも同じ計算式を置くが、それはUIプレビュー専用で、DBの算出結果と一致することを
ユニットテストで固定する。

### DB制約の検証

`docs/db-constraints.sql` が実際に効いているかは、空のDBに対して検証スクリプトを流して確認する。

```bash
createdb segrr_test
DATABASE_URL="postgresql://.../segrr_test" npx prisma migrate deploy
psql "postgresql://.../segrr_test" -f tests/db/verify-constraints.sql
```

47項目すべてが `✓ PASS` になること。これがタスクA2の完了条件。

## 開発の進め方

モデルの役割分担とレビューの運用は [`docs/PM-instructions-for-claude-code.md`](docs/PM-instructions-for-claude-code.md) を参照。
`.claude/commands/` に切り替え用のコマンドを用意してある。

| コマンド | 役割 | モデル |
|---|---|---|
| `/review-design` | 実装前の設計査読 | Fable 5.1 |
| `/review-code` | 差分のコードレビュー | Fable 5.1 |
| `/implement` | ビジネスロジックの実装 | Opus 5 |
| `/scaffold` | ボイラープレート・CRUD・テスト生成 | Sonnet 5 |

査読役にパッチを直接当てさせないこと。指摘 → 承認 → 実装側が適用、の順を守る。
