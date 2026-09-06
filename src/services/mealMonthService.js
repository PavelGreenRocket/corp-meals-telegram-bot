const pool = require("../db/pool");
const { getMonthRange } = require("../utils/dateHelpers");

let ensureMealMonthStateSchemaPromise = null;

async function ensureMealMonthStateSchema() {
  if (!ensureMealMonthStateSchemaPromise) {
    ensureMealMonthStateSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS meal_month_closures (
          id BIGSERIAL PRIMARY KEY,
          close_year INTEGER NOT NULL CHECK (close_year >= 2000),
          close_month SMALLINT NOT NULL CHECK (close_month BETWEEN 1 AND 12),
          status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
          source_type VARCHAR(20) CHECK (source_type IS NULL OR source_type IN ('manual', 'excel')),
          source_file_path TEXT,
          original_file_name TEXT,
          source_file_sha256 TEXT,
          total_days INTEGER NOT NULL DEFAULT 0 CHECK (total_days >= 0),
          total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
          confirmed_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
          confirmed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (close_year, close_month)
        )
      `);
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_meal_month_closures_period ON meal_month_closures(close_year, close_month)"
      );
    })().catch((error) => {
      ensureMealMonthStateSchemaPromise = null;
      throw error;
    });
  }

  await ensureMealMonthStateSchemaPromise;
}

async function getMonthMealSummary(year, month, db = pool) {
  const { startDate, endDate } = getMonthRange(month, year);
  const { rows } = await db.query(
    `
      SELECT
        COALESCE(SUM(amount), 0) AS total_amount,
        COUNT(*)::INT AS entries_count,
        COUNT(DISTINCT (meal_date, employee_id))::INT AS days_count
      FROM meal_entries
      WHERE meal_date BETWEEN $1 AND $2
    `,
    [startDate, endDate]
  );

  return {
    startDate,
    endDate,
    totalAmount: Number(rows[0]?.total_amount || 0),
    entriesCount: Number(rows[0]?.entries_count || 0),
    daysCount: Number(rows[0]?.days_count || 0)
  };
}

async function getMealMonthState(year, month) {
  await ensureMealMonthStateSchema();
  const [summary, closureResult] = await Promise.all([
    getMonthMealSummary(year, month),
    pool.query(
      `
        SELECT *
        FROM meal_month_closures
        WHERE close_year = $1 AND close_month = $2
        LIMIT 1
      `,
      [year, month]
    )
  ]);

  const closure = closureResult.rows[0] || null;
  const status = closure?.status === "confirmed"
    ? "confirmed"
    : summary.entriesCount > 0
      ? "draft"
      : "empty";

  return {
    year,
    month,
    status,
    isConfirmed: status === "confirmed",
    sourceType: closure?.source_type || null,
    sourceFilePath: closure?.source_file_path || null,
    originalFileName: closure?.original_file_name || null,
    confirmedAt: closure?.confirmed_at || null,
    confirmedByUserId: closure?.confirmed_by_user_id || null,
    ...summary
  };
}

async function saveMealMonthConfirmation({
  year,
  month,
  sourceType,
  sourceFilePath = null,
  originalFileName = null,
  sourceFileSha256 = null,
  totalDays = 0,
  totalAmount = 0,
  userId = null
}, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO meal_month_closures (
        close_year,
        close_month,
        status,
        source_type,
        source_file_path,
        original_file_name,
        source_file_sha256,
        total_days,
        total_amount,
        confirmed_by_user_id,
        confirmed_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), NOW())
      ON CONFLICT (close_year, close_month)
      DO UPDATE
      SET status = 'confirmed',
          source_type = EXCLUDED.source_type,
          source_file_path = EXCLUDED.source_file_path,
          original_file_name = EXCLUDED.original_file_name,
          source_file_sha256 = EXCLUDED.source_file_sha256,
          total_days = EXCLUDED.total_days,
          total_amount = EXCLUDED.total_amount,
          confirmed_by_user_id = EXCLUDED.confirmed_by_user_id,
          confirmed_at = NOW(),
          updated_at = NOW()
      RETURNING *
    `,
    [
      year,
      month,
      sourceType,
      sourceFilePath,
      originalFileName,
      sourceFileSha256,
      Number(totalDays || 0),
      Number(totalAmount || 0),
      userId
    ]
  );

  return rows[0] || null;
}

async function confirmMealMonthManually({ year, month, userId = null }) {
  await ensureMealMonthStateSchema();
  const summary = await getMonthMealSummary(year, month);
  await saveMealMonthConfirmation({
    year,
    month,
    sourceType: "manual",
    totalDays: summary.daysCount,
    totalAmount: summary.totalAmount,
    userId
  });

  return getMealMonthState(year, month);
}

async function invalidateMealMonthConfirmation(year, month, db = pool) {
  const { rows } = await db.query(
    `
      UPDATE meal_month_closures
      SET status = 'draft',
          confirmed_at = NULL,
          confirmed_by_user_id = NULL,
          updated_at = NOW()
      WHERE close_year = $1
        AND close_month = $2
        AND status = 'confirmed'
      RETURNING id
    `,
    [year, month]
  );

  return Boolean(rows[0]);
}

async function invalidateMealMonthConfirmationByDate(mealDate, db = pool) {
  const match = String(mealDate || "").slice(0, 10).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) {
    return false;
  }

  return invalidateMealMonthConfirmation(Number(match[1]), Number(match[2]), db);
}

module.exports = {
  confirmMealMonthManually,
  ensureMealMonthStateSchema,
  getMealMonthState,
  getMonthMealSummary,
  invalidateMealMonthConfirmation,
  invalidateMealMonthConfirmationByDate,
  saveMealMonthConfirmation
};
