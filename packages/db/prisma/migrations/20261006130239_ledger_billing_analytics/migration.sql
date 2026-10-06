-- CreateEnum
CREATE TYPE "LedgerOwnerType" AS ENUM ('COMPANY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('TOP_UP', 'CHECK_IN_CHARGE', 'PROMO_GRANT');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'CAPTURED', 'FAILED');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "ownerType" "LedgerOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayOrderId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventId" TEXT,
    "eventType" TEXT,
    "gatewayPaymentId" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "rawBody" TEXT NOT NULL,
    "outcome" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_ownerType_ownerId_currency_key" ON "ledger_accounts"("ownerType", "ownerId", "currency");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_createdAt_idx" ON "ledger_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_refType_refId_idx" ON "ledger_entries"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_txnId_accountId_direction_key" ON "ledger_entries"("txnId", "accountId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_event_effectiveFrom_key" ON "pricing_rules"("event", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_gatewayOrderId_key" ON "payment_orders"("gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_gatewayPaymentId_key" ON "payment_orders"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "payment_orders_companyId_createdAt_idx" ON "payment_orders"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_events_eventId_idx" ON "payment_events"("eventId");

-- CreateIndex
CREATE INDEX "payment_events_gatewayPaymentId_idx" ON "payment_events"("gatewayPaymentId");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger rules live here rather than in application code, so no code path,
-- script or psql session can break them by accident. A database superuser can
-- still disable triggers; these guard against the application, not against
-- someone with full control of the database.

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amountPaise" > 0);
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_price_not_negative" CHECK ("pricePaise" >= 0);
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_amount_positive" CHECK ("amountPaise" > 0);

-- Every txnId balances, checked when the transaction commits rather than per
-- row, so one transaction can insert both legs. A later transaction adding an
-- unbalanced leg to an old txnId fails the same way.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  debits bigint;
  credits bigint;
  currencies int;
BEGIN
  SELECT
    COALESCE(SUM(e."amountPaise") FILTER (WHERE e.direction = 'DEBIT'), 0),
    COALESCE(SUM(e."amountPaise") FILTER (WHERE e.direction = 'CREDIT'), 0),
    COUNT(DISTINCT a.currency)
  INTO debits, credits, currencies
  FROM "ledger_entries" e
  JOIN "ledger_accounts" a ON a.id = e."accountId"
  WHERE e."txnId" = NEW."txnId";

  IF debits <> credits THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced: debits % paise, credits % paise', NEW."txnId", debits, credits
      USING ERRCODE = 'check_violation';
  END IF;
  IF currencies > 1 THEN
    RAISE EXCEPTION 'ledger transaction % mixes currencies', NEW."txnId" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entries_balanced"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Append-only: a mistake is corrected by a new, reversing transaction, never
-- by changing history. Accounts and prices are held to the same rule, since
-- editing either would silently change what past entries mean.
CREATE FUNCTION ledger_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER "ledger_accounts_append_only" BEFORE UPDATE OR DELETE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER "ledger_accounts_no_truncate" BEFORE TRUNCATE ON "ledger_accounts"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER "pricing_rules_append_only" BEFORE UPDATE OR DELETE ON "pricing_rules"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_change();
CREATE TRIGGER "pricing_rules_no_truncate" BEFORE TRUNCATE ON "pricing_rules"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_change();

-- Has no effect on the table's owner, which is the role the app connects as;
-- it stops any other role that is ever granted access. The triggers are the
-- real guard.
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entries", "ledger_accounts", "pricing_rules" FROM PUBLIC;

-- Balance = credits - debits, for every account, always computed.
CREATE VIEW "ledger_balances" AS
SELECT
  a.id AS "accountId",
  a."ownerType",
  a."ownerId",
  a.currency,
  (COALESCE(SUM(e."amountPaise") FILTER (WHERE e.direction = 'CREDIT'), 0)
    - COALESCE(SUM(e."amountPaise") FILTER (WHERE e.direction = 'DEBIT'), 0))::bigint AS "balancePaise"
FROM "ledger_accounts" a
LEFT JOIN "ledger_entries" e ON e."accountId" = a.id
GROUP BY a.id;

-- The opening price: Rs 200 per verified check-in. Effective from the moment
-- this migration runs, so check-ins from before billing existed are never
-- charged.
INSERT INTO "pricing_rules" ("id", "event", "unit", "pricePaise", "effectiveFrom")
VALUES ('price_checkin_launch', 'CHECK_IN_VERIFIED', 'PER_CHECK_IN', 20000, CURRENT_TIMESTAMP);

-- Employer analytics, refreshed every 15 minutes by the worker. "confirmed"
-- comes from the audit log, not the current state: a hired or absent
-- candidate did book a seat, and their current state has forgotten it.
CREATE MATERIALIZED VIEW "drive_funnel" AS
WITH apps AS (
  SELECT
    a.id,
    a."driveId",
    a.state,
    COALESCE(ci."isValid", false) AS checked_in,
    COALESCE(ci.method = 'WALK_IN', false) AS walk_in,
    EXISTS (
      SELECT 1 FROM "audit_logs" al
      WHERE al."entityType" = 'application' AND al."entityId" = a.id AND al.action LIKE '%->CONFIRMED'
    ) AS ever_confirmed
  FROM "applications" a
  LEFT JOIN "check_ins" ci ON ci."applicationId" = a.id
)
SELECT
  d.id AS "driveId",
  d."companyId",
  (SELECT count(DISTINCT n."candidateId") FROM "notifications" n
    WHERE n."driveId" = d.id AND n."templateKey" = 'drive_48h' AND n.status = 'SENT')::int AS alerted,
  count(apps.id) FILTER (WHERE NOT apps.walk_in)::int AS interested,
  count(apps.id) FILTER (WHERE apps.ever_confirmed)::int AS confirmed,
  count(apps.id) FILTER (WHERE apps.ever_confirmed AND apps.checked_in)::int AS "checkedIn",
  count(apps.id) FILTER (WHERE apps.walk_in AND apps.checked_in)::int AS "walkIns",
  count(apps.id) FILTER (WHERE apps.state = 'HIRED')::int AS hired
FROM "drives" d
LEFT JOIN apps ON apps."driveId" = d.id
GROUP BY d.id;

CREATE UNIQUE INDEX "drive_funnel_driveId" ON "drive_funnel"("driveId");
CREATE INDEX "drive_funnel_companyId" ON "drive_funnel"("companyId");

-- Days are India's days: a check-in at 00:30 IST belongs to that morning.
CREATE MATERIALIZED VIEW "company_daily" AS
SELECT "companyId", day, sum(check_ins)::int AS "checkIns", sum(hires)::int AS hires
FROM (
  SELECT d."companyId", (ci."scannedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day, 1 AS check_ins, 0 AS hires
  FROM "check_ins" ci
  JOIN "applications" a ON a.id = ci."applicationId"
  JOIN "drives" d ON d.id = a."driveId"
  WHERE ci."isValid"
  UNION ALL
  SELECT d."companyId", (al."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 0, 1
  FROM "audit_logs" al
  JOIN "applications" a ON a.id = al."entityId"
  JOIN "drives" d ON d.id = a."driveId"
  WHERE al."entityType" = 'application' AND al.action LIKE '%->HIRED'
) events
GROUP BY "companyId", day;

CREATE UNIQUE INDEX "company_daily_companyId_day" ON "company_daily"("companyId", day);
