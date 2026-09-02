-- Segrr: Prisma標準マイグレーション適用後に追加で流すSQL
-- 対象: 金額の整合性をDBレベルで担保する
-- 適用方法: `prisma migrate dev` 実行後、`prisma/migrations/<timestamp>_add_amount_constraints/migration.sql`
--           として保存するか、`npx prisma db execute --file this.sql` で個別適用する

-- ─────────────────────────────
-- 1. 明細行の amount を生成列にする(quantity * unitPrice の手入力ミスを防ぐ)
-- ─────────────────────────────
-- Prismaは生成列を直接定義できないため、カラムを一度落として生成列として再作成する。
-- Prisma Client側では amount を書き込み対象から除外すること(読み取り専用として扱う)。

ALTER TABLE "QuoteItem" DROP COLUMN "amount";
ALTER TABLE "QuoteItem" ADD COLUMN "amount" INTEGER
  GENERATED ALWAYS AS ("quantity" * "unitPrice") STORED;

ALTER TABLE "ContractItem" DROP COLUMN "amount";
ALTER TABLE "ContractItem" ADD COLUMN "amount" INTEGER
  GENERATED ALWAYS AS ("quantity" * "unitPrice") STORED;

ALTER TABLE "InvoiceItem" DROP COLUMN "amount";
ALTER TABLE "InvoiceItem" ADD COLUMN "amount" INTEGER
  GENERATED ALWAYS AS ("quantity" * "unitPrice") STORED;

-- ─────────────────────────────
-- 2. 「請求済み合計 ≦ 契約金額」をトリガーで強制する
--    (分割請求の合計超過をDBレベルで防ぐ。要件定義書v1 セクション2・5参照)
-- ─────────────────────────────

CREATE OR REPLACE FUNCTION check_invoice_total_within_contract()
RETURNS TRIGGER AS $$
DECLARE
  contract_total INTEGER;
  invoiced_total INTEGER;
BEGIN
  SELECT "totalAmount" INTO contract_total
  FROM "Contract"
  WHERE id = NEW."contractId";

  SELECT COALESCE(SUM("amount"), 0) INTO invoiced_total
  FROM "Invoice"
  WHERE "contractId" = NEW."contractId"
    AND status <> 'CANCELLED'
    AND id <> NEW.id; -- 自分自身(更新時)は除いて計算し、最後にNEWの金額を足す

  IF (invoiced_total + NEW."amount") > contract_total THEN
    RAISE EXCEPTION
      '請求合計(%)が契約金額(%)を超えています。契約ID: %',
      (invoiced_total + NEW."amount"), contract_total, NEW."contractId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_invoice_total ON "Invoice";
CREATE TRIGGER trg_check_invoice_total
  BEFORE INSERT OR UPDATE ON "Invoice"
  FOR EACH ROW
  EXECUTE FUNCTION check_invoice_total_within_contract();

-- ─────────────────────────────
-- 注意点
-- ─────────────────────────────
-- ・このトリガーはstatus='CANCELLED'の請求書を合計から除外する。
--   請求書を「削除」ではなく「キャンセル」で扱う設計と対にすること(監査ログの観点からも削除は避ける)。
-- ・アプリ層(server/services/invoice-service.ts)でも同じチェックを行うこと。
--   理由: DBトリガーはUIに分かりやすいエラーメッセージを返せないため、
--   ユーザー向けのバリデーションはアプリ層、最終防衛線としてDBトリガー、の二重構成にする。
-- ・生成列(amount)はPrisma Client生成後、型定義上は書き込み可能なフィールドとして出てしまうため、
--   サービス層のcreate/update処理で明示的にamountを渡さない実装にすること。
