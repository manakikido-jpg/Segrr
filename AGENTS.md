<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Segrr プロジェクトのルール

着手前に `docs/segrr-requirements-v1.md`(要件定義書・正)と
`docs/phase0-task-breakdown.md`(タスク分解)を読むこと。

## 金額まわり(最重要)

**金額の正はDBにある。** 明細の `amount`、書類の合計・消費税・源泉徴収は、
`docs/db-constraints.sql` のトリガーが明細から算出する。
**アプリからこれらのカラムを書き込まないこと**(対象一覧は `prisma/schema.prisma` 冒頭のコメント)。

- 単価は**税抜**で入力。値引きは単価をマイナスにした明細行で表現する
- 消費税の端数処理は**1書類につき税率ごとに1回**。明細行ごとに丸めない(適格請求書の要件)
- 分割請求の超過チェックは**税抜**で比較する(税込だと端数で誤判定する)
- 源泉徴収は税抜額が対象。100万円以下は 10.21%、超過分は 20.42% + 102,100円
- TS側(`src/lib/tax.ts`)の計算式はUIプレビュー専用。DBの算出結果と一致することを
  `tests/unit` で固定すること

`docs/db-constraints.sql` を変更したら、必ず `tests/db/verify-constraints.sql` を
空のDBに流して全項目 PASS を確認する。

## マルチテナント

`organizationId` は**必ずセッションから取得する**。リクエストボディからは決して読まない。

## データ継承

見積→契約、契約→請求の変換は**明細をコピー**する(参照で済ませない)。
変換後は元の書類が編集不可になる(DBトリガーで強制)。修正は新しい書類を作り直す。

## モデルの役割分担

`.claude/commands/` のコマンドを使う。査読役(Fable 5.1)にパッチを直接当てさせないこと。
詳細は `docs/PM-instructions-for-claude-code.md`。
