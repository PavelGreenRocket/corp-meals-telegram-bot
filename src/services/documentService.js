const path = require("path");
const config = require("../config");
const pool = require("../db/pool");
const {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES
} = require("../constants");
const { createActDocx } = require("../docs/createActDocx");
const { createReconciliationDocx } = require("../docs/createReconciliationDocx");
const { buildReconciliationData, getReconciliationPeriodBounds } = require("./ledgerService");
const { getLegacyMaxActNumber } = require("./legacySettlementService");
const { getActSummaryForPeriod, getMonthlyActSummary } = require("./mealService");
const { getMonthUploadedDocument } = require("./monthDocumentService");
const {
  getCustomerDetails,
  getDocumentSettings,
  getPerformerDetails
} = require("./settingsService");
const { buildFilePath, ensureDir, sanitizeFileName } = require("../utils/files");
const { formatDateRu, getMonthRange, isFullMonthPeriod, monthYearLabel, todayIso } = require("../utils/dateHelpers");

const ACT_NUMBER_LOCK_KEY = 472021;
let ensureDocumentConstraintsPromise = null;

async function ensureDocumentConstraints() {
  if (!ensureDocumentConstraintsPromise) {
    ensureDocumentConstraintsPromise = (async () => {
      await pool.query(
        `
          CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_documents_act_number_unique
          ON generated_documents (document_number)
          WHERE doc_type = 'act' AND document_number IS NOT NULL
        `
      );
    })().catch((error) => {
      ensureDocumentConstraintsPromise = null;
      throw error;
    });
  }

  await ensureDocumentConstraintsPromise;
}

async function createDocumentRecord(payload, db = pool) {
  const { rows } = await db.query(
    `
      INSERT INTO generated_documents (
        doc_type,
        status,
        document_number,
        document_date,
        period_start,
        period_end,
        act_month,
        act_year,
        days_count,
        total_amount,
        opening_balance,
        charged_total,
        paid_total,
        closing_balance,
        generated_file_path,
        note,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, NOW(), NOW()
      )
      RETURNING *
    `,
    [
      payload.docType,
      payload.status || DOCUMENT_STATUSES.GENERATED,
      payload.documentNumber || null,
      payload.documentDate,
      payload.periodStart,
      payload.periodEnd,
      payload.actMonth || null,
      payload.actYear || null,
      payload.daysCount || 0,
      payload.totalAmount || 0,
      payload.openingBalance || 0,
      payload.chargedTotal || 0,
      payload.paidTotal || 0,
      payload.closingBalance || 0,
      payload.generatedFilePath,
      payload.note || null,
      payload.createdByUserId || null
    ]
  );

  return rows[0];
}

async function listDocuments({ docType = null, limit = 20, offset = 0 } = {}) {
  const filters = [];
  const values = [];

  if (docType) {
    values.push(docType);
    filters.push(`doc_type = $${values.length}`);
  }

  values.push(limit);
  values.push(offset);

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `
      SELECT *
      FROM generated_documents
      ${whereClause}
      ORDER BY document_date DESC, id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );
  return rows;
}

async function getDocumentById(documentId) {
  const { rows } = await pool.query("SELECT * FROM generated_documents WHERE id = $1", [documentId]);
  return rows[0] || null;
}

async function getMonthDocuments(month, year) {
  const [actUpload, reconciliationUpload, generated] = await Promise.all([
    getMonthUploadedDocument(DOCUMENT_TYPES.ACT, year, month),
    getMonthUploadedDocument(DOCUMENT_TYPES.RECONCILIATION, year, month),
    pool.query(
      `
        SELECT *
        FROM generated_documents
        WHERE (doc_type = 'act' AND act_month = $1 AND act_year = $2)
           OR (
              doc_type = 'reconciliation'
              AND EXTRACT(MONTH FROM period_end)::INT = $1
              AND EXTRACT(YEAR FROM period_end)::INT = $2
            )
        ORDER BY document_date DESC, id DESC
      `,
      [month, year]
    )
  ]);
  const { rows } = generated;

  let act = actUpload ? {
    ...actUpload,
    doc_type: DOCUMENT_TYPES.ACT,
    document_date: `${year}-${String(month).padStart(2, "0")}-01`,
    period_start: `${year}-${String(month).padStart(2, "0")}-01`,
    period_end: getMonthRange(month, year).endDate,
    act_month: month,
    act_year: year,
    is_month_upload: true
  } : null;
  let reconciliation = reconciliationUpload ? {
    ...reconciliationUpload,
    doc_type: DOCUMENT_TYPES.RECONCILIATION,
    document_date: `${year}-${String(month).padStart(2, "0")}-01`,
    period_start: `${year}-${String(month).padStart(2, "0")}-01`,
    period_end: getMonthRange(month, year).endDate,
    is_month_upload: true
  } : null;

  const signedAct = rows.find((document) =>
    document.doc_type === DOCUMENT_TYPES.ACT && document.signed_file_path
  );
  const signedReconciliation = rows.find((document) =>
    document.doc_type === DOCUMENT_TYPES.RECONCILIATION && document.signed_file_path
  );

  if (signedAct && !act) {
    act = signedAct;
  }

  if (signedReconciliation && !reconciliation) {
    reconciliation = signedReconciliation;
  }

  rows.forEach((document) => {
    if (document.doc_type === DOCUMENT_TYPES.ACT && !act) {
      act = document;
      return;
    }

    if (document.doc_type === DOCUMENT_TYPES.RECONCILIATION && !reconciliation) {
      reconciliation = document;
    }
  });

  return { act, reconciliation };
}

async function hasDocumentsInYear(year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const { rows } = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM generated_documents
        WHERE (act_year = $1)
           OR (period_start BETWEEN $2 AND $3)
           OR (period_end BETWEEN $2 AND $3)
           OR (document_date BETWEEN $2 AND $3)
      ) AS has_documents
    `,
    [year, startDate, endDate]
  );

  return Boolean(rows[0]?.has_documents);
}

async function markDocumentSent(documentId) {
  const { rows } = await pool.query(
    `
      UPDATE generated_documents
      SET status = CASE WHEN status = 'signed' THEN status ELSE 'sent' END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [documentId]
  );
  return rows[0] || null;
}

async function attachSignedDocument(documentId, signedFilePath, uploadedByUserId = null) {
  const { rows } = await pool.query(
    `
      UPDATE generated_documents
      SET signed_file_path = $2,
          status = 'signed',
          uploaded_signed_by_user_id = $3,
          uploaded_signed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [documentId, signedFilePath, uploadedByUserId]
  );
  return rows[0] || null;
}

async function findCanonicalActForPeriod(startDate, endDate, db = pool) {
  const legacyMaxActNumber = getLegacyMaxActNumber();
  const { rows } = await db.query(
    `
      SELECT *
      FROM generated_documents
      WHERE doc_type = 'act'
        AND period_start::DATE = $1::DATE
        AND period_end::DATE = $2::DATE
        AND document_number ~ '^[0-9]+$'
        AND document_number::BIGINT > $3
      ORDER BY document_number::BIGINT ASC, id ASC
      LIMIT 1
    `,
    [startDate, endDate, legacyMaxActNumber]
  );

  return rows[0] || null;
}

async function getNextActNumber(db = pool) {
  const legacyMaxActNumber = getLegacyMaxActNumber();
  const { rows } = await db.query(
    `
      WITH canonical_period_acts AS (
        SELECT DISTINCT ON (all_acts.period_start, all_acts.period_end)
          all_acts.document_number::BIGINT AS document_number
        FROM (
          SELECT DISTINCT period_start::DATE AS period_start, period_end::DATE AS period_end
          FROM generated_documents
          WHERE doc_type = 'act'
            AND signed_file_path IS NOT NULL
        ) signed_periods
        JOIN (
          SELECT document_number, period_start::DATE AS period_start, period_end::DATE AS period_end, id
          FROM generated_documents
          WHERE doc_type = 'act'
            AND document_number ~ '^[0-9]+$'
            AND document_number::BIGINT > $1
        ) all_acts
        ON all_acts.period_start = signed_periods.period_start
          AND all_acts.period_end = signed_periods.period_end
        ORDER BY all_acts.period_start, all_acts.period_end, all_acts.document_number::BIGINT ASC, all_acts.id ASC
      )
      SELECT COALESCE(MAX(document_number), $1) AS numeric_max
      FROM canonical_period_acts
    `
    ,
    [legacyMaxActNumber]
  );

  return String(Number(rows[0]?.numeric_max || legacyMaxActNumber) + 1);
}

function buildActServiceDescription(serviceName, startDate, endDate) {
  if (isFullMonthPeriod(startDate, endDate)) {
    const month = Number(String(startDate).slice(5, 7));
    const year = Number(String(startDate).slice(0, 4));
    return `${serviceName} за ${monthYearLabel(month, year)}`;
  }

  return `${serviceName} за период с ${formatDateRu(startDate)} по ${formatDateRu(endDate)}`;
}

function buildActPeriodText(startDate, endDate) {
  if (isFullMonthPeriod(startDate, endDate)) {
    const month = Number(String(startDate).slice(5, 7));
    const year = Number(String(startDate).slice(0, 4));
    return monthYearLabel(month, year);
  }

  return `период с ${formatDateRu(startDate)} по ${formatDateRu(endDate)}`;
}

async function generateMonthlyAct({
  month,
  year,
  startDate = null,
  endDate = null,
  actNumber = null,
  actDate = todayIso(),
  userId = null
}) {
  await ensureDir(config.documentsDir);
  await ensureDocumentConstraints();

  const summary = startDate && endDate
    ? await getActSummaryForPeriod(startDate, endDate)
    : await getMonthlyActSummary(month, year);

  const [performer, customer, documentSettings] = await Promise.all([
    getPerformerDetails(),
    getCustomerDetails(),
    getDocumentSettings()
  ]);

  const effectiveMonth = Number(month || String(summary.startDate).slice(5, 7));
  const effectiveYear = Number(year || String(summary.startDate).slice(0, 4));
  const serviceDescription = buildActServiceDescription(documentSettings.serviceName, summary.startDate, summary.endDate);
  const periodText = buildActPeriodText(summary.startDate, summary.endDate);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ACT_NUMBER_LOCK_KEY]);

    const existingPeriodAct = await findCanonicalActForPeriod(summary.startDate, summary.endDate, client);
    const resolvedActNumber = String(actNumber || existingPeriodAct?.document_number || await getNextActNumber(client)).trim();
    const fileName = sanitizeFileName(`act_${effectiveYear}_${String(effectiveMonth).padStart(2, "0")}_${resolvedActNumber}.docx`);
    const filePath = buildFilePath(config.documentsDir, fileName);

    await createActDocx(filePath, {
      actDate,
      actNumber: resolvedActNumber,
      customer,
      daysCount: summary.daysCount,
      daysCountDisplay: summary.daysCount == null ? "-" : String(summary.daysCount),
      month: effectiveMonth,
      performer,
      periodEnd: summary.endDate,
      periodLabel: periodText,
      periodStart: summary.startDate,
      serviceDescription,
      totalAmount: summary.totalAmount,
      vatText: documentSettings.vatText,
      year: effectiveYear
    });

    const record = existingPeriodAct && !actNumber
      ? (await client.query(
        `
          UPDATE generated_documents
          SET document_date = $2,
              act_month = $3,
              act_year = $4,
              days_count = $5,
              total_amount = $6,
              generated_file_path = $7,
              created_by_user_id = COALESCE($8, created_by_user_id),
              note = $9,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          existingPeriodAct.id,
          actDate,
          effectiveMonth,
          effectiveYear,
          summary.daysCount || 0,
          summary.totalAmount || 0,
          filePath,
          userId,
          `Акт за ${periodText}`
        ]
      )).rows[0]
      : await createDocumentRecord({
        docType: DOCUMENT_TYPES.ACT,
        documentNumber: resolvedActNumber,
        documentDate: actDate,
        periodStart: summary.startDate,
        periodEnd: summary.endDate,
        actMonth: effectiveMonth,
        actYear: effectiveYear,
        daysCount: summary.daysCount,
        totalAmount: summary.totalAmount,
        generatedFilePath: filePath,
        createdByUserId: userId,
        note: `Акт за ${periodText}`
      }, client);

    await client.query("COMMIT");

    return {
      ...record,
      filePath,
      summary,
      serviceDescription
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function generateReconciliationDocument({
  documentDate = todayIso(),
  startDate = null,
  endDate = null,
  includeUnsignedPreviousMonth = false,
  userId = null
}) {
  await ensureDir(config.documentsDir);

  const defaultPeriod = await getReconciliationPeriodBounds(documentDate, { includeUnsignedPreviousMonth });
  const effectiveStartDate = startDate || defaultPeriod.startDate;
  const effectiveEndDate = endDate || defaultPeriod.endDate;

  const [performer, customer] = await Promise.all([
    getPerformerDetails(),
    getCustomerDetails()
  ]);

  const reconciliation = await buildReconciliationData({
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    documentDate,
    includeUnsignedPreviousMonth
  });

  const fileName = sanitizeFileName(`reconciliation_${effectiveStartDate}_${effectiveEndDate}.docx`);
  const filePath = path.join(config.documentsDir, fileName);

  await createReconciliationDocx(filePath, {
    ...reconciliation,
    customer,
    performer
  });

  const record = await createDocumentRecord({
    docType: DOCUMENT_TYPES.RECONCILIATION,
    documentDate,
    periodStart: reconciliation.periodStart,
    periodEnd: reconciliation.periodEnd,
    totalAmount: reconciliation.chargedTotal,
    openingBalance: reconciliation.openingBalance,
    chargedTotal: reconciliation.chargedTotal,
    paidTotal: reconciliation.paidTotal,
    closingBalance: reconciliation.closingBalance,
    generatedFilePath: filePath,
    createdByUserId: userId,
    note: reconciliation.note
  });

  return {
    ...record,
    filePath,
    reconciliation
  };
}

module.exports = {
  attachSignedDocument,
  generateMonthlyAct,
  generateReconciliationDocument,
  getDocumentById,
  getMonthDocuments,
  hasDocumentsInYear,
  listDocuments,
  markDocumentSent
};
