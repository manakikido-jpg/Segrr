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
| `DATABASE_URL` | PostgreSQL 接続文字列 | ローカルは `postgresql://<user>:<pass>@localhost:5432/segrr` |
| `AUTH_SECRET` | Auth.js のセッション署名鍵 | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Google OAuth クライアントID | Google Cloud Console → 認証情報 → OAuth 2.0 クライアント |
| `AUTH_GOOGLE_SECRET` | 同シークレット | 同上 |

Google OAuth の承認済みリダイレクトURIには `http://localhost:3000/api/auth/callback/google` を登録する。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest(ユニットテスト) |
| `npm run test:e2e` | Playwright |
| `npm run db:migrate` | マイグレーション作成・適用(開発) |
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

39項目すべてが `✓ PASS` になること。これがタスクA2の完了条件。

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
