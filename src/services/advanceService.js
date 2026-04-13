const pool = require("../db/pool");

let ensureAdvanceDocumentColumnsPromise = null;

async function ensureAdvanceDocumentColumns() {
  if (!ensureAdvanceDocumentColumnsPromise) {
    ensureAdvanceDocumentColumnsPromise = (async () => {
      await pool.query("ALTER TABLE advances ADD COLUMN IF NOT EXISTS document_file_path TEXT");
      await pool.query("ALTER TABLE advances ADD COLUMN IF NOT EXISTS document_original_name TEXT");
      await pool.query(
        "ALTER TABLE advances ADD COLUMN IF NOT EXISTS document_uploaded_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL"
      );
      await pool.query("ALTER TABLE advances ADD COLUMN IF NOT EXISTS document_uploaded_at TIMESTAMPTZ");
    })().catch((error) => {
      ensureAdvanceDocumentColumnsPromise = null;
      throw error;
    });
  }

  await ensureAdvanceDocumentColumnsPromise;
}

async function createAdvance({ paymentDate, amount, comment = null, createdByUserId = null }) {
  await ensureAdvanceDocumentColumns();
  const { rows } = await pool.query(
    `
      INSERT INTO advances (
        payment_date, amount, comment, created_by_user_id, updated_by_user_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $4, NOW(), NOW())
      RETURNING *
    `,
    [paymentDate, amount, comment, createdByUserId]
  );
  return rows[0];
}

async function getAdvanceById(advanceId) {
  await ensureAdvanceDocumentColumns();
  const { rows } = await pool.query(
    `
      SELECT a.*, u.full_name AS creator_name
      FROM advances a
      LEFT JOIN app_users u ON u.id = a.created_by_user_id
      WHERE a.id = $1
    `,
    [advanceId]
  );
  return rows[0] || null;
}

async function updateAdvance(advanceId, { paymentDate, amount, comment = null, updatedByUserId = null }) {
  await ensureAdvanceDocumentColumns();
  const { rows } = await pool.query(
    `
      UPDATE advances
      SET payment_date = $2,
          amount = $3,
          comment = $4,
          updated_by_user_id = $5,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [advanceId, paymentDate, amount, comment, updatedByUserId]
  );
  return rows[0] || null;
}

async function deleteAdvance(advanceId) {
  await ensureAdvanceDocumentColumns();
  const { rows } = await pool.query("DELETE FROM advances WHERE id = $1 RETURNING *", [advanceId]);
  return rows[0] || null;
}

async function listAdvances({ startDate = null, endDate = null, limit = 20, offset = 0 } = {}) {
  await ensureAdvanceDocumentColumns();
  const filters = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    filters.push(`a.payment_date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`a.payment_date <= $${values.length}`);
  }

  values.push(limit);
  values.push(offset);

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `
      SELECT a.*, u.full_name AS creator_name
      FROM advances a
      LEFT JOIN app_users u ON u.id = a.created_by_user_id
      ${whereClause}
      ORDER BY a.payment_date DESC, a.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );

  return rows;
}

async function getAdvanceTotals({ startDate = null, endDate = null } = {}) {
  await ensureAdvanceDocumentColumns();
  const filters = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    filters.push(`payment_date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`payment_date <= $${values.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `
      SELECT COALESCE(SUM(amount), 0) AS total_amount, COUNT(*) AS entries_count
      FROM advances
      ${whereClause}
    `,
    values
  );

  return {
    totalAmount: Number(rows[0]?.total_amount || 0),
    entriesCount: Number(rows[0]?.entries_count || 0)
  };
}

async function getLatestAdvance({ startDate = null, endDate = null, requireDocument = false } = {}) {
  await ensureAdvanceDocumentColumns();
  const filters = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    filters.push(`a.payment_date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`a.payment_date <= $${values.length}`);
  }

  if (requireDocument) {
    filters.push("a.document_file_path IS NOT NULL");
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `
      SELECT a.*, u.full_name AS creator_name
      FROM advances a
      LEFT JOIN app_users u ON u.id = a.created_by_user_id
      ${whereClause}
      ORDER BY a.payment_date DESC, a.updated_at DESC, a.id DESC
      LIMIT 1
    `,
    values
  );

  return rows[0] || null;
}

async function attachAdvanceDocument(
  advanceId,
  { documentFilePath, documentOriginalName = null, uploadedByUserId = null } = {}
) {
  await ensureAdvanceDocumentColumns();
  const { rows } = await pool.query(
    `
      UPDATE advances
      SET document_file_path = $2,
          document_original_name = $3,
          document_uploaded_by_user_id = $4,
          document_uploaded_at = NOW(),
          updated_by_user_id = $4,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [advanceId, documentFilePath, documentOriginalName, uploadedByUserId]
  );

  return rows[0] || null;
}

module.exports = {
  attachAdvanceDocument,
  createAdvance,
  deleteAdvance,
  getAdvanceById,
  getLatestAdvance,
  getAdvanceTotals,
  listAdvances,
  updateAdvance
};
