# Segrr プロジェクト構成案(Phase 0)

技術スタック: Next.js(App Router) + TypeScript + Prisma + PostgreSQL + NextAuth

```
segrr/
├── README.md                      # セットアップ手順・環境変数一覧
├── design/                        # デザインキャンバス(Claude Design 出力)
│   ├── segrr-ui.dc.html           # 全14アートボード
│   ├── Nav.dc.html / Badge.dc.html # 共有パーツ
│   └── logo.png / support.js / uploads/
├── docs/
│   ├── segrr-requirements-v1.md   # 要件定義書(このリポジトリの正)
│   ├── project-structure.md       # このファイル
│   ├── phase0-task-breakdown.md   # タスク分解
│   ├── PM-instructions-for-claude-code.md # モデル運用・査読の進め方
│   ├── design-brief.md            # デザイン依頼時のプロンプト
│   ├── design-spec.md             # デザインの仕様まとめ(Claude Design 出力)
│   └── db-constraints.sql         # 金額・消費税・テナント整合性のDB制約
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                # db-constraints.sql は空マイグレーションに貼って履歴に残す
│   └── seed.ts                    # 開発用シード(本人+テスターのOrganization/Membership/Invitation)
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── api/auth/[...nextauth]/
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx         # サイドナビ + Organization切り替え(将来用)
│   │   │   ├── page.tsx           # ダッシュボード(案件サマリ)
│   │   │   ├── customers/
│   │   │   │   ├── page.tsx       # 一覧
│   │   │   │   └── [id]/page.tsx  # 詳細・編集
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx  # 案件詳細(見積・契約・請求のタイムライン表示)
│   │   │   ├── quotes/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── contracts/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx   # ?fromQuote=<id> で見積から生成
│   │   │   │   └── [id]/page.tsx
│   │   │   └── invoices/
│   │   │       ├── page.tsx
│   │   │       ├── new/page.tsx   # ?fromContract=<id> で契約から生成
│   │   │       └── [id]/page.tsx
│   │   └── api/
│   │       ├── customers/
│   │       ├── projects/
│   │       ├── quotes/
│   │       ├── contracts/
│   │       ├── invoices/
│   │       └── pdf/                # PDF生成エンドポイント
│   ├── components/
│   │   ├── ui/                     # 汎用UIパーツ(ボタン・テーブル・フォーム部品)
│   │   ├── documents/               # 見積書/契約書/請求書 共通の明細行編集コンポーネント等
│   │   └── dashboard/
│   ├── server/
│   │   ├── services/                # ビジネスロジック(見積→契約変換、金額バリデーション等)
│   │   │   ├── quote-service.ts
│   │   │   ├── contract-service.ts
│   │   │   └── invoice-service.ts   # 分割請求の合計金額チェックはここに集約
│   │   └── validators/              # zodスキーマ(フォーム入力・API入出力の型検証)
│   ├── styles/
│   │   └── tokens.css               # デザイントークン(design/ のアートボード13が出典)
│   ├── lib/
│   │   ├── db.ts                    # Prisma Client シングルトン
│   │   ├── auth.ts                  # NextAuth設定(Googleプロバイダ + 招待制チェック)
│   │   ├── tax.ts                   # 消費税・源泉徴収の計算(UIプレビュー用。DBトリガーと同じ式)
│   │   └── pdf.ts                   # PDF生成ユーティリティ
│   └── types/
├── tests/
│   ├── unit/                        # server/services のロジックテスト(特に金額計算・バリデーション)
│   ├── db/                          # db-constraints.sql の検証(実DBに対して実行。A2の完了条件)
│   │   └── verify-constraints.sql
│   └── e2e/                         # 見積→契約→請求の一連フローのE2E
└── .claude/
    └── commands/                    # Claude Code用カスタムコマンド(モデル切り替え等、後述)
```

## 補足

- `server/services/` にビジネスロジックを集約するのは、見積→契約→請求のデータ継承と金額バリデーションが複数画面から呼ばれるため、UIコンポーネント側にロジックを分散させないための構成です。
- `lib/tax.ts` はUIの即時プレビュー専用です。**金額の正はDB(`docs/db-constraints.sql` のトリガー)** で、サービス層は合計・消費税・源泉徴収のカラムを書き込みません。両者の計算結果が一致することを `tests/unit/tax.test.ts` で固定します。
- `server/services/` の各関数は `organizationId` をセッション由来の値として引数で受け取り、リクエストボディからは決して読みません。
- `.claude/commands/` は、モデルの役割分担(Sonnet 5 / Opus 5 / Fable 5.1)を毎回指定せずに済むよう、コマンド化する想定の置き場所です(詳細は `docs/PM-instructions-for-claude-code.md` 参照)。
