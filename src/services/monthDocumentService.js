const pool = require("../db/pool");

let ensureMonthDocumentsTablePromise = null;

async function ensureMonthDocumentsTable() {
  if (!ensureMonthDocumentsTablePromise) {
    ensureMonthDocumentsTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS month_uploaded_documents (
          id BIGSERIAL PRIMARY KEY,
          doc_kind VARCHAR(20) NOT NULL CHECK (doc_kind IN ('reconciliation')),
          doc_year INTEGER NOT NULL CHECK (doc_year >= 2000),
          doc_month SMALLINT NOT NULL CHECK (doc_month BETWEEN 1 AND 12),
          signed_file_path TEXT NOT NULL,
          original_file_name TEXT,
          created_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
          updated_by_user_id BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (doc_kind, doc_year, doc_month)
        )
      `);
      await pool.query(
        "CREATE INDEX IF NOT EXISTS idx_month_uploaded_documents_period ON month_uploaded_documents(doc_kind, doc_year, doc_month)"
      );
    })().catch((error) => {
      ensureMonthDocumentsTablePromise = null;
      throw error;
    });
  }

  await ensureMonthDocumentsTablePromise;
}

async function getMonthUploadedDocument(docKind, year, month) {
  await ensureMonthDocumentsTable();
  const { rows } = await pool.query(
    `
      SELECT *
      FROM month_uploaded_documents
      WHERE doc_kind = $1 AND doc_year = $2 AND doc_month = $3
      LIMIT 1
    `,
    [docKind, year, month]
  );

  return rows[0] || null;
}

async function upsertMonthUploadedDocument({
  docKind,
  year,
  month,
  signedFilePath,
  originalFileName = null,
  userId = null
}) {
  await ensureMonthDocumentsTable();
  const { rows } = await pool.query(
    `
      INSERT INTO month_uploaded_documents (
        doc_kind,
        doc_year,
        doc_month,
        signed_file_path,
        original_file_name,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6, NOW(), NOW())
      ON CONFLICT (doc_kind, doc_year, doc_month)
      DO UPDATE
      SET signed_file_path = EXCLUDED.signed_file_path,
          original_file_name = EXCLUDED.original_file_name,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = NOW()
      RETURNING *
    `,
    [docKind, year, month, signedFilePath, originalFileName, userId]
  );

  return rows[0] || null;
}

module.exports = {
  getMonthUploadedDocument,
  upsertMonthUploadedDocument
};
