-- Seggr: docs/db-constraints.sql のDBレベル検証
--
-- タスクA2の完了条件はこのスクリプトが全項目 PASS することで判定する。
-- ユニットテストのモックでは検証できないため、必ず実DBに対して実行すること。
--
-- 実行方法:
--   createdb seggr_test
--   npx prisma migrate deploy   # schema.prisma + db-constraints.sql のマイグレーション
--   psql -d seggr_test -f tests/db/verify-constraints.sql
--
-- 期待結果: ✓ PASS が47件、✗ FAIL が0件。
-- 空のDBに対して実行すること(テストデータを固定IDで投入するため)。

-- 最初のエラーで止める。これがないと土台のINSERTが失敗した後も走り続け、
-- 1件の原因が数十件の FAIL に見えてしまう。
\set ON_ERROR_STOP on
SET client_min_messages TO NOTICE;

CREATE OR REPLACE FUNCTION t_fail(label TEXT, stmt TEXT) RETURNS VOID AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE WARNING '✗ FAIL  % — 弾かれるべき操作が通ってしまいました', label;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✓ PASS  % — 拒否: %', label, left(SQLERRM, 70);
  END;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION t_ok(label TEXT, stmt TEXT) RETURNS VOID AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE NOTICE '✓ PASS  % — 正常に実行', label;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '✗ FAIL  % — 通るべき操作が拒否されました: %', label, SQLERRM;
  END;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION t_eq(label TEXT, actual BIGINT, expected BIGINT) RETURNS VOID AS $$
BEGIN
  IF actual IS NOT DISTINCT FROM expected THEN
    RAISE NOTICE '✓ PASS  % = %', label, actual;
  ELSE
    RAISE WARNING '✗ FAIL  % : 期待 % / 実際 %', label, expected, actual;
  END IF;
END $$ LANGUAGE plpgsql;

-- ── 土台 ──────────────────────────────
INSERT INTO "Organization"(id,name) VALUES ('org1','本人事業'),('org2','別の組織');
INSERT INTO "Customer"(id,"organizationId",name) VALUES ('cus1','org1','株式会社テスト');
INSERT INTO "Project"(id,"organizationId","customerId",name) VALUES ('prj1','org1','cus1','サイト制作');

-- ── ① 明細の amount 自動算出 + ② 税率ごとに1回だけ端数処理 ──
INSERT INTO "Quote"(id,"organizationId","projectId",number) VALUES ('qt1','org1','prj1','Q-2026-0001');
INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice","taxRate") VALUES
  ('qi1','qt1','デザイン費',2,500,10),      -- 10%: 1000
  ('qi2','qt1','資料(軽減税率)',1,333,8),   -- 8%: 333
  ('qi3','qt1','資料(軽減税率)',1,333,8),
  ('qi4','qt1','資料(軽減税率)',1,333,8);
DO $$ BEGIN
  PERFORM t_eq('① QuoteItem.amount (2 x 500)', (SELECT amount FROM "QuoteItem" WHERE id='qi1'), 1000);
  PERFORM t_eq('② subtotal10',  (SELECT "subtotal10"  FROM "Quote" WHERE id='qt1'), 1000);
  PERFORM t_eq('② tax10  (1000 x 10%)', (SELECT "tax10" FROM "Quote" WHERE id='qt1'), 100);
  PERFORM t_eq('② subtotal8',   (SELECT "subtotal8"   FROM "Quote" WHERE id='qt1'), 999);
  -- 明細ごとに丸めると floor(26.64)x3 = 78 になる。書類単位で1回なら floor(79.92) = 79
  PERFORM t_eq('② tax8 (999 x 8% を書類単位で切り捨て)', (SELECT "tax8" FROM "Quote" WHERE id='qt1'), 79);
  PERFORM t_eq('② totalAmount', (SELECT "totalAmount" FROM "Quote" WHERE id='qt1'), 2178);
END $$;

-- ── ⑤ 契約に変換した見積は編集不可 ──
INSERT INTO "Contract"(id,"organizationId","projectId","sourceQuoteId",number)
  VALUES ('ct1','org1','prj1','qt1','C-2026-0001');
INSERT INTO "ContractItem"(id,"contractId",name,quantity,"unitPrice","taxRate")
  VALUES ('ci1','ct1','デザイン費',1,1000000,10);
DO $$ BEGIN
  PERFORM t_eq('   Contract.subtotal (継承後)', (SELECT subtotal FROM "Contract" WHERE id='ct1'), 1000000);
  PERFORM t_fail('⑤ 変換済み見積の明細を更新', $q$UPDATE "QuoteItem" SET "unitPrice"=9999 WHERE id='qi1'$q$);
  PERFORM t_fail('⑤ 変換済み見積に明細を追加', $q$INSERT INTO "QuoteItem"(id,"quoteId",name,"unitPrice") VALUES('qiX','qt1','追加',1)$q$);
  PERFORM t_fail('⑤ 変換済み見積の明細を削除', $q$DELETE FROM "QuoteItem" WHERE id='qi2'$q$);
END $$;

-- ── ③ 金額0で請求書を作ってから明細を足しても超過が弾かれる ──
INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"sequenceNo")
  VALUES ('iv1','org1','prj1','ct1','I-2026-0001',1);
INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice","taxRate")
  VALUES ('ii1','iv1','着手金',1,600000,10);
DO $$ BEGIN
  PERFORM t_eq('   1枚目の請求(税抜)', (SELECT subtotal FROM "Invoice" WHERE id='iv1'), 600000);
  PERFORM t_ok('③ 2枚目を金額0で作成(この時点では合法)',
    $q$INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"sequenceNo")
       VALUES ('iv2','org1','prj1','ct1','I-2026-0002',2)$q$);
  PERFORM t_fail('③ 2枚目に明細を追加して契約超過(600000+600000 > 1000000)',
    $q$INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice","taxRate")
       VALUES ('ii2','iv2','中間金',1,600000,10)$q$);
  PERFORM t_ok('③ 残額ちょうど(400000)なら通る',
    $q$INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice","taxRate")
       VALUES ('ii3','iv2','残金',1,400000,10)$q$);
  PERFORM t_eq('   請求済み合計(税抜)',
    (SELECT SUM(subtotal) FROM "Invoice" WHERE "contractId"='ct1' AND status<>'CANCELLED'), 1000000);
END $$;

-- ── ④ 契約金額の減額を弾く ──
DO $$ BEGIN
  PERFORM t_fail('④ 発行済み請求合計より契約金額を下げる',
    $q$UPDATE "Contract" SET subtotal=500000 WHERE id='ct1'$q$);
  PERFORM t_fail('   請求書が存在する契約の明細を編集',
    $q$UPDATE "ContractItem" SET "unitPrice"=500000 WHERE id='ci1'$q$);
END $$;

-- ── ⑥ DRAFT以外は物理削除できない ──
DO $$ BEGIN
  PERFORM t_ok('   請求書を送付済みにする', $q$UPDATE "Invoice" SET status='SENT' WHERE id='iv1'$q$);
  PERFORM t_fail('⑥ 送付済み請求書を削除', $q$DELETE FROM "Invoice" WHERE id='iv1'$q$);
  PERFORM t_fail('⑥ 契約に変換済みの見積を削除', $q$DELETE FROM "Quote" WHERE id='qt1'$q$);
END $$;

-- ── テナント整合性 ──
DO $$ BEGIN
  PERFORM t_fail('⑦ 別組織の請求書を org1 の契約にぶら下げる',
    $q$INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"sequenceNo")
       VALUES ('ivX','org2','prj1','ct1','I-2026-9999',9)$q$);
END $$;

-- ── 源泉徴収 ──
INSERT INTO "Project"(id,"organizationId","customerId",name) VALUES ('prj2','org1','cus1','原稿執筆');
INSERT INTO "Contract"(id,"organizationId","projectId",number) VALUES ('ct2','org1','prj2','C-2026-0002');
INSERT INTO "ContractItem"(id,"contractId",name,quantity,"unitPrice") VALUES ('ci2','ct2','原稿料',1,2000000);
INSERT INTO "Invoice"(id,"organizationId","projectId","contractId",number,"withholdingApplied")
  VALUES ('iv3','org1','prj2','ct2','I-2026-0003',true);
INSERT INTO "InvoiceItem"(id,"invoiceId",name,quantity,"unitPrice") VALUES ('ii4','iv3','原稿料',1,1000000);
DO $$ BEGIN
  PERFORM t_eq('⑧ 源泉徴収(税抜100万 x 10.21%)', (SELECT "withholdingTax" FROM "Invoice" WHERE id='iv3'), 102100);
  PERFORM t_eq('⑧ 差引請求額(1,100,000 - 102,100)', (SELECT "paymentAmount" FROM "Invoice" WHERE id='iv3'), 997900);
  PERFORM t_ok('   100万超に増額', $q$UPDATE "InvoiceItem" SET "unitPrice"=2000000 WHERE id='ii4'$q$);
  PERFORM t_eq('⑧ 源泉徴収(税抜200万: 100万超部分 20.42% + 102,100)',
    (SELECT "withholdingTax" FROM "Invoice" WHERE id='iv3'), 306300);
  PERFORM t_ok('   源泉徴収を対象外に戻す', $q$UPDATE "Invoice" SET "withholdingApplied"=false WHERE id='iv3'$q$);
  PERFORM t_eq('⑧ 対象外なら0', (SELECT "withholdingTax" FROM "Invoice" WHERE id='iv3'), 0);
END $$;

-- ── 値引き行(単価をマイナスで入力) ──
-- デザイン仕様: 値引きは専用カラムではなく、単価をマイナスにした明細行で表現し、
-- 同じ税率の課税対象から差し引く。
INSERT INTO "Project"(id,"organizationId","customerId",name) VALUES ('prj3','org1','cus1','値引き検証');
INSERT INTO "Quote"(id,"organizationId","projectId",number) VALUES ('qt3','org1','prj3','EST-0003');
INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice","taxRate") VALUES
  ('qd1','qt3','制作費',1,100000,10),
  ('qd2','qt3','継続割引',1,-10000,10);
DO $$ BEGIN
  PERFORM t_eq('⑪ 値引き行の amount', (SELECT amount FROM "QuoteItem" WHERE id='qd2'), -10000);
  PERFORM t_eq('⑪ 値引き後の税抜小計(100000 - 10000)', (SELECT "subtotal10" FROM "Quote" WHERE id='qt3'), 90000);
  PERFORM t_eq('⑪ 値引き後の消費税(90000 x 10%)', (SELECT "tax10" FROM "Quote" WHERE id='qt3'), 9000);
  PERFORM t_eq('⑪ 値引き後の税込合計', (SELECT "totalAmount" FROM "Quote" WHERE id='qt3'), 99000);
  PERFORM t_fail('⑪ 値引きが大きすぎて小計がマイナス',
    $q$UPDATE "QuoteItem" SET "unitPrice"=-200000 WHERE id='qd2'$q$);
  PERFORM t_ok('⑪ 単位(人日)を持つ工数行',
    $q$INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,unit,"unitPrice") VALUES('qd3','qt3','実装',5,'人日',80000)$q$);
  PERFORM t_eq('⑪ 工数行の amount (5人日 x 80000)', (SELECT amount FROM "QuoteItem" WHERE id='qd3'), 400000);
END $$;

-- ── 小数の数量(半日単位・時間単位の請求) ──
INSERT INTO "Quote"(id,"organizationId","projectId",number) VALUES ('qt4','org1','prj3','EST-0004');
INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,unit,"unitPrice","taxRate") VALUES
  ('qf1','qt4','設計(半日)',0.5,'人日',80000,10),
  ('qf2','qt4','実装(時間精算)',7.5,'時間',3333,10),
  ('qf3','qt4','打ち合わせ',0.25,'時間',3333,10);
DO $$ BEGIN
  PERFORM t_eq('⑫ 0.5人日 x 80,000円', (SELECT amount FROM "QuoteItem" WHERE id='qf1'), 40000);
  -- 24,997.5 をゼロ方向に切り捨て
  PERFORM t_eq('⑫ 7.5時間 x 3,333円 = 24,997.5 → 切り捨て', (SELECT amount FROM "QuoteItem" WHERE id='qf2'), 24997);
  PERFORM t_eq('⑫ 0.25時間 x 3,333円 = 833.25 → 切り捨て', (SELECT amount FROM "QuoteItem" WHERE id='qf3'), 833);
  PERFORM t_eq('⑫ 小数を含む税抜合計', (SELECT subtotal FROM "Quote" WHERE id='qt4'), 65830);
  PERFORM t_ok('⑫ 小数の値引き行はゼロ方向に切り捨て(-24,997.5 → -24,997)',
    $q$INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice") VALUES('qf4','qt4','値引き',7.5,-3333)$q$);
  PERFORM t_eq('⑫ 値引き行の amount(floor なら -24,998 になる)',
    (SELECT amount FROM "QuoteItem" WHERE id='qf4'), -24997);
  PERFORM t_fail('⑫ 数量0', $q$INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice") VALUES('qfX','qt4','x',0,1)$q$);
  PERFORM t_fail('⑫ 数量が上限超え', $q$INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice") VALUES('qfY','qt4','x',100001,1)$q$);
  PERFORM t_fail('⑫ 金額が INTEGER の範囲を超える',
    $q$INSERT INTO "QuoteItem"(id,"quoteId",name,quantity,"unitPrice") VALUES('qfZ','qt4','x',100000,1000000000)$q$);
END $$;

-- ── 入力値チェックとカスケード削除 ──
INSERT INTO "Quote"(id,"organizationId","projectId",number) VALUES ('qt2','org1','prj1','Q-2026-0002');
INSERT INTO "QuoteItem"(id,"quoteId",name,"unitPrice") VALUES ('qi9','qt2','下書き明細',100);
DO $$ BEGIN
  PERFORM t_fail('⑨ 税率5%の明細',      $q$INSERT INTO "QuoteItem"(id,"quoteId",name,"unitPrice","taxRate") VALUES('qiY','qt2','x',1,5)$q$);
  PERFORM t_fail('⑨ 不正な登録番号',      $q$UPDATE "Organization" SET "invoiceRegistrationNumber"='12345' WHERE id='org1'$q$);
  PERFORM t_ok('⑨ 正しい登録番号',        $q$UPDATE "Organization" SET "invoiceRegistrationNumber"='T1234567890123' WHERE id='org1'$q$);
  PERFORM t_ok('⑩ 下書き見積は明細ごと削除できる(カスケード)', $q$DELETE FROM "Quote" WHERE id='qt2'$q$);
END $$;
