---
description: ボイラープレート・単純なCRUD・テストコードをSonnet 5で生成する
model: claude-sonnet-5
argument-hint: [生成するものの説明]
---

以下を実装してください。定型的な作業なので、既存のパターンに合わせることを優先します。

$ARGUMENTS

## 合わせるもの

- 既存のコンポーネントとサービスの書き方(`src/components/`, `src/server/services/`)
- デザイントークン `src/styles/tokens.css`。色や余白を直接書かず、必ず CSS 変数を使う
- zod スキーマは `src/server/validators/` に置く

## 守ること

- 合計・消費税・源泉徴収のカラムは書き込まない(DBトリガーが算出する)
- `organizationId` はセッションから取得する
- 判断に迷う仕様が出てきたら、自分で決めずに質問する
