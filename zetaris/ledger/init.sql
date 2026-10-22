-- The owner's "accounting database" (SYNTHETIC data, labelled synthetic in every row).
-- Loaded once by the postgres entrypoint from the CSVs produced by scripts/gen-ledgers.ts.
CREATE TABLE businesses (
  business_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  nace        TEXT NOT NULL,
  sector      TEXT NOT NULL,
  synthetic   BOOLEAN NOT NULL
);
CREATE TABLE ledger_monthly (
  business_id      TEXT NOT NULL REFERENCES businesses(business_id),
  period           TEXT NOT NULL,
  units            INTEGER NOT NULL,
  transactions     INTEGER NOT NULL,
  revenue          DOUBLE PRECISION NOT NULL,
  cogs             DOUBLE PRECISION NOT NULL,
  gross_margin_pct DOUBLE PRECISION NOT NULL,
  avg_ticket       DOUBLE PRECISION NOT NULL,
  synthetic        BOOLEAN NOT NULL,
  PRIMARY KEY (business_id, period)
);
CREATE TABLE calendar_monthly (
  period        TEXT PRIMARY KEY,
  easter_date   TEXT NOT NULL,
  easter_share  DOUBLE PRECISION NOT NULL,
  days_in_month INTEGER NOT NULL
);
COPY businesses FROM '/seed/businesses.csv' WITH (FORMAT csv, HEADER true);
COPY ledger_monthly FROM '/seed/ledger.csv' WITH (FORMAT csv, HEADER true);
COPY calendar_monthly FROM '/seed/calendar.csv' WITH (FORMAT csv, HEADER true);
