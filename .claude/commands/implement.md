---
description: ビジネスロジックをOpus 5で実装する
model: claude-opus-5
argument-hint: [タスク番号と実装内容]
---

以下を実装してください。

$ARGUMENTS

## 着手前に読むもの

- `docs/phase0-task-breakdown.md` — このタスクの完了条件
- `docs/seggr-requirements-v1.md` — 要件定義書(正)
- `docs/db-constraints.sql` — DBが保証している不変条件
- `prisma/schema.prisma` — 冒頭のコメントに「アプリから書き込まないカラム」の一覧がある

## 守ること

- **合計・消費税・源泉徴収のカラムは書き込まない。** DBトリガーが明細から算出する。
  TS側(`src/lib/tax.ts`)の計算式はUIプレビュー専用で、DBの算出結果と一致することを
  `tests/unit` で固定する
- **`organizationId` はセッションから取得する。** リクエストボディからは決して読まない
- 見積→契約、契約→請求の変換は**明細をコピー**する。参照で済ませない
- 分割請求の超過チェックは**税抜**で比較する
- 完了したら、タスク表の完了条件を満たしているか自分で確認してから報告する
