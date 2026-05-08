const pool = require("../db/pool");
const { formatDateRu, getMonthRange, todayIso } = require("../utils/dateHelpers");
const { formatAmount } = require("../utils/money");
const {
  buildLegacyActTitle,
  getLegacyAdvanceRows,
  getLegacyAdvanceTotal,
  getLegacyJournalEntry,
  getLegacyMaxActNumber,
  getLegacyMealChargeRows,
  getLegacyMealChargesForReconciliation,
  getLegacyMealTotal,
  getLegacyYearlyTotals
} = require("./legacySettlementService");

async function getBalanceSummary() {
  const [{ rows: advanceRows }, { rows: mealRows }] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(amount), 0) AS total_amount FROM advances"),
    pool.query("SELECT COALESCE(SUM(amount), 0) AS total_amount FROM meal_entries")
  ]);

  const totalPaid = Number(advanceRows[0]?.total_amount || 0) + getLegacyAdvanceTotal();
  const totalCharged = Number(mealRows[0]?.total_amount || 0) + getLegacyMealTotal();

  return {
    totalPaid,
    totalCharged,
    balance: Number((totalPaid - totalCharged).toFixed(2))
  };
}

async function getLedgerRows({ startDate = null, endDate = null } = {}) {
  const filters = [];
  const values = [];

  if (startDate) {
    values.push(startDate);
    filters.push(`date_value >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`date_value <= $${values.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `
      SELECT *
      FROM (
        SELECT
          a.id,
          'advance' AS operation_type,
          a.payment_date AS date_value,
          a.amount,
          a.comment,
          NULL::TEXT AS employee_name,
          FALSE AS is_legacy
        FROM advances a
        UNION ALL
        SELECT
          me.id,
          'meal' AS operation_type,
          me.meal_date AS date_value,
          me.amount,
          me.comment,
          e.full_name AS employee_name,
          FALSE AS is_legacy
        FROM meal_entries me
        JOIN employees e ON e.id = me.employee_id
      ) ledger
      ${whereClause}
      ORDER BY date_value DESC, id DESC
    `,
    values
  );

  const legacyRows = [
    ...getLegacyAdvanceRows({ startDate, endDate }),
    ...getLegacyMealChargeRows({ startDate, endDate })
  ];

  return [...rows, ...legacyRows].sort((left, right) => {
    const leftDate = String(left.date_value);
    const rightDate = String(right.date_value);

    if (leftDate === rightDate) {
      return String(right.id).localeCompare(String(left.id));
    }

    return rightDate.localeCompare(leftDate);
  });
}

async function getYearlyMonthlyTotals(year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const [{ rows: advanceRows }, { rows: mealRows }] = await Promise.all([
    pool.query(
      `
        SELECT EXTRACT(MONTH FROM payment_date)::INT AS month, COALESCE(SUM(amount), 0) AS total_amount
        FROM advances
        WHERE payment_date BETWEEN $1 AND $2
        GROUP BY 1
      `,
      [startDate, endDate]
    ),
    pool.query(
      `
        SELECT EXTRACT(MONTH FROM meal_date)::INT AS month, COALESCE(SUM(amount), 0) AS total_amount
        FROM meal_entries
        WHERE meal_date BETWEEN $1 AND $2
        GROUP BY 1
      `,
      [startDate, endDate]
    )
  ]);

  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    advanceTotal: 0,
    mealTotal: 0
  }));
  const legacy = getLegacyYearlyTotals(year);

  advanceRows.forEach((row) => {
    const item = months[Number(row.month) - 1];
    if (item) {
      item.advanceTotal = Number(row.total_amount || 0);
    }
  });

  mealRows.forEach((row) => {
    const item = months[Number(row.month) - 1];
    if (item) {
      item.mealTotal = Number(row.total_amount || 0);
    }
  });

  legacy.months.forEach((legacyItem) => {
    const item = months[legacyItem.month - 1];
    if (item) {
      item.advanceTotal += Number(legacyItem.advanceTotal || 0);
      item.mealTotal += Number(legacyItem.mealTotal || 0);
    }
  });

  return {
    months,
    extraPeriods: legacy.extraPeriods
  };
}

function getPreviousMonthPeriod(documentDate = todayIso()) {
  const normalizedDate = String(documentDate || todayIso());
  const match = normalizedDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date();
  const previous = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const month = previous.getMonth() + 1;
  const year = previous.getFullYear();

  return {
    month,
    year,
    ...getMonthRange(month, year)
  };
}

function normalizeIsoDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0")
    ].join("-");
  }

  return String(value).slice(0, 10);
}

async function getUnsignedPreviousMonthActCandidate(documentDate = todayIso()) {
  const period = getPreviousMonthPeriod(documentDate);
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(meal_totals.total_amount, 0) AS total_amount,
        EXISTS (
          SELECT 1
          FROM generated_documents
          WHERE doc_type = 'act'
            AND signed_file_path IS NOT NULL
            AND (
              (period_start::DATE = $1 AND period_end::DATE = $2)
              OR (act_year = $3 AND act_month = $4)
            )
        ) AS has_signed_generated_act,
        EXISTS (
          SELECT 1
          FROM month_uploaded_documents
          WHERE doc_kind = 'act'
            AND doc_year = $3
            AND doc_month = $4
        ) AS has_uploaded_act,
        (
          SELECT document_number
          FROM generated_documents
          WHERE doc_type = 'act'
            AND period_start::DATE = $1
            AND period_end::DATE = $2
            AND document_number ~ '^[0-9]+$'
          ORDER BY document_number::BIGINT ASC, id ASC
          LIMIT 1
        ) AS document_number,
        (
          SELECT document_date
          FROM generated_documents
          WHERE doc_type = 'act'
            AND period_start::DATE = $1
            AND period_end::DATE = $2
          ORDER BY signed_file_path IS NOT NULL DESC, uploaded_signed_at DESC NULLS LAST, id DESC
          LIMIT 1
        ) AS document_date
      FROM (
        SELECT COALESCE(SUM(amount), 0) AS total_amount
        FROM meal_entries
        WHERE meal_date BETWEEN $1 AND $2
      ) meal_totals
    `,
    [period.startDate, period.endDate, period.year, period.month]
  );

  const row = rows[0] || {};
  const totalAmount = Number(row.total_amount || 0);
  if (totalAmount <= 0 || row.has_signed_generated_act || row.has_uploaded_act) {
    return null;
  }

  return {
    ...period,
    documentNumber: row.document_number || null,
    documentDate: normalizeIsoDateValue(row.document_date) || period.endDate,
    totalAmount
  };
}

async function getReconciliationPeriodBounds(documentDate = todayIso(), options = {}) {
  const normalizedDocumentDate = documentDate || todayIso();
  const unsignedPreviousMonth = options.includeUnsignedPreviousMonth
    ? await getUnsignedPreviousMonthActCandidate(normalizedDocumentDate)
    : null;
  const legacyDateCandidates = [
    ...getLegacyAdvanceRows({ endDate: normalizedDocumentDate }).map((item) => item.date_value),
    ...getLegacyMealChargesForReconciliation(normalizedDocumentDate).map((item) => item.operationDate)
  ].sort();

  const { rows } = await pool.query(
    `
      WITH effective_acts AS (
        SELECT DISTINCT ON (act_year, act_month)
          document_date
        FROM (
          SELECT act_year, act_month, document_date, uploaded_signed_at, id
          FROM generated_documents
          WHERE doc_type = 'act'
            AND signed_file_path IS NOT NULL
            AND document_date <= $1
          UNION ALL
          SELECT
            doc_year AS act_year,
            doc_month AS act_month,
            (make_date(doc_year, doc_month, 1) + INTERVAL '1 month - 1 day')::DATE AS document_date,
            updated_at AS uploaded_signed_at,
            id
          FROM month_uploaded_documents
          WHERE doc_kind = 'act'
            AND (make_date(doc_year, doc_month, 1) + INTERVAL '1 month - 1 day')::DATE <= $1
        ) acts
        ORDER BY act_year, act_month, uploaded_signed_at DESC NULLS LAST, id DESC
      )
      SELECT
        MIN(operation_date) AS start_date,
        MAX(operation_date) AS end_date
      FROM (
        SELECT payment_date AS operation_date
        FROM advances
        WHERE payment_date <= $1
        UNION ALL
        SELECT document_date AS operation_date
        FROM effective_acts
        UNION ALL
        SELECT $2::DATE AS operation_date
        WHERE $3::BOOLEAN
      ) history
    `,
    [normalizedDocumentDate, unsignedPreviousMonth?.documentDate || null, Boolean(unsignedPreviousMonth)]
  );

  const dbStartDate = normalizeIsoDateValue(rows[0]?.start_date);
  const dbEndDate = normalizeIsoDateValue(rows[0]?.end_date);
  const legacyStartDate = legacyDateCandidates[0] || null;
  const legacyEndDate = legacyDateCandidates[legacyDateCandidates.length - 1] || null;
  const startDate = [dbStartDate, legacyStartDate].filter(Boolean).sort()[0] || normalizedDocumentDate;
  const endDate = [dbEndDate, legacyEndDate].filter(Boolean).sort().at(-1) || normalizedDocumentDate;

  return {
    startDate,
    endDate
  };
}

async function buildReconciliationData({
  startDate = null,
  endDate = null,
  documentDate = todayIso(),
  includeUnsignedPreviousMonth = false
}) {
  const unsignedPreviousMonth = includeUnsignedPreviousMonth
    ? await getUnsignedPreviousMonthActCandidate(documentDate)
    : null;
  const defaultPeriod = await getReconciliationPeriodBounds(documentDate, { includeUnsignedPreviousMonth });
  const effectiveStartDate = startDate || defaultPeriod.startDate;
  const effectiveEndDate = endDate || defaultPeriod.endDate;
  const legacyMaxActNumber = getLegacyMaxActNumber();

  const openingRows = await pool.query(
      `
        WITH uploaded_act_periods AS (
          SELECT
            make_date(doc_year, doc_month, 1)::DATE AS period_start,
            (make_date(doc_year, doc_month, 1) + INTERVAL '1 month - 1 day')::DATE AS period_end
          FROM month_uploaded_documents
          WHERE doc_kind = 'act'
        ),
        unsigned_previous_month_act_period AS (
          SELECT $2::DATE AS period_start, $3::DATE AS period_end
          WHERE $4::BOOLEAN
        ),
        act_periods AS (
          SELECT period_start, period_end FROM uploaded_act_periods
          UNION
          SELECT period_start::DATE, period_end::DATE
          FROM generated_documents
          WHERE doc_type = 'act'
            AND signed_file_path IS NOT NULL
          UNION
          SELECT period_start, period_end FROM unsigned_previous_month_act_period
        ),
        effective_acts AS (
          SELECT
            COALESCE(generated_act.document_date, act_periods.period_end) AS document_date,
            COALESCE(generated_act.total_amount, meal_totals.total_amount, 0) AS total_amount
          FROM act_periods
          LEFT JOIN LATERAL (
            SELECT document_date, total_amount
            FROM generated_documents
            WHERE doc_type = 'act'
              AND period_start::DATE = act_periods.period_start
              AND period_end::DATE = act_periods.period_end
            ORDER BY signed_file_path IS NOT NULL DESC, uploaded_signed_at DESC NULLS LAST, id DESC
            LIMIT 1
          ) generated_act ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount), 0) AS total_amount
            FROM meal_entries
            WHERE meal_date BETWEEN act_periods.period_start AND act_periods.period_end
          ) meal_totals ON TRUE
        )
      SELECT COALESCE(SUM(paid_delta - charged_delta), 0) AS opening_balance
      FROM (
        SELECT payment_date AS doc_date, amount AS paid_delta, 0::NUMERIC AS charged_delta
        FROM advances
        UNION ALL
        SELECT document_date AS doc_date, 0::NUMERIC AS paid_delta, total_amount AS charged_delta
        FROM effective_acts
      ) operations
      WHERE doc_date < $1
    `,
    [
      effectiveStartDate,
      unsignedPreviousMonth?.startDate || null,
      unsignedPreviousMonth?.endDate || null,
      Boolean(unsignedPreviousMonth)
    ]
  );

  const legacyOpeningPaid = getLegacyAdvanceRows({ endDate: effectiveStartDate })
    .filter((item) => item.date_value < effectiveStartDate)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const legacyOpeningCharged = getLegacyMealChargesForReconciliation(effectiveEndDate)
    .filter((item) => item.operationDate < effectiveStartDate)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const openingBalance = Number((
    Number(openingRows.rows[0]?.opening_balance || 0) + legacyOpeningPaid - legacyOpeningCharged
  ).toFixed(2));

  const [{ rows: advances }, { rows: acts }] = await Promise.all([
    pool.query(
      `
        SELECT id, payment_date, amount, comment
        FROM advances
        WHERE payment_date BETWEEN $1 AND $2
        ORDER BY payment_date ASC, id ASC
      `,
      [effectiveStartDate, effectiveEndDate]
    ),
    pool.query(
      `
        WITH uploaded_act_periods AS (
          SELECT
            make_date(doc_year, doc_month, 1)::DATE AS period_start,
            (make_date(doc_year, doc_month, 1) + INTERVAL '1 month - 1 day')::DATE AS period_end
          FROM month_uploaded_documents
          WHERE doc_kind = 'act'
        ),
        unsigned_previous_month_act_period AS (
          SELECT $4::DATE AS period_start, $5::DATE AS period_end
          WHERE $6::BOOLEAN
        ),
        act_periods AS (
          SELECT period_start, period_end FROM uploaded_act_periods
          UNION
          SELECT period_start::DATE, period_end::DATE
          FROM generated_documents
          WHERE doc_type = 'act'
            AND signed_file_path IS NOT NULL
          UNION
          SELECT period_start, period_end FROM unsigned_previous_month_act_period
        ),
        effective_acts AS (
          SELECT
            COALESCE(signed_acts.document_date, act_periods.period_end) AS document_date,
            canonical_numbers.document_number,
            COALESCE(signed_acts.total_amount, meal_totals.total_amount, 0) AS total_amount,
            act_periods.period_start,
            act_periods.period_end
          FROM act_periods
          LEFT JOIN LATERAL (
            SELECT document_date, total_amount
            FROM generated_documents
            WHERE doc_type = 'act'
              AND period_start::DATE = act_periods.period_start
              AND period_end::DATE = act_periods.period_end
            ORDER BY signed_file_path IS NOT NULL DESC, uploaded_signed_at DESC NULLS LAST, id DESC
            LIMIT 1
          ) signed_acts ON TRUE
          LEFT JOIN LATERAL (
            SELECT DISTINCT ON (period_start::DATE, period_end::DATE)
              document_number,
              period_start::DATE AS period_start,
              period_end::DATE AS period_end
            FROM generated_documents
            WHERE doc_type = 'act'
              AND document_number ~ '^[0-9]+$'
              AND document_number::BIGINT > $3
            ORDER BY period_start::DATE, period_end::DATE, document_number::BIGINT ASC, id ASC
          ) canonical_numbers
          ON canonical_numbers.period_start = act_periods.period_start
            AND canonical_numbers.period_end = act_periods.period_end
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount), 0) AS total_amount
            FROM meal_entries
            WHERE meal_date BETWEEN act_periods.period_start AND act_periods.period_end
          ) meal_totals ON TRUE
        )
        SELECT document_date, document_number, total_amount, period_start, period_end
        FROM effective_acts
        WHERE document_date BETWEEN $1 AND $2
        ORDER BY document_date ASC, document_number ASC
      `,
      [
        effectiveStartDate,
        effectiveEndDate,
        legacyMaxActNumber,
        unsignedPreviousMonth?.startDate || null,
        unsignedPreviousMonth?.endDate || null,
        Boolean(unsignedPreviousMonth)
      ]
    )
  ]);

  const legacyAdvances = getLegacyAdvanceRows({ startDate: effectiveStartDate, endDate: effectiveEndDate });
  const legacyActs = getLegacyMealChargesForReconciliation(effectiveEndDate)
    .filter((item) => item.operationDate >= effectiveStartDate && item.operationDate <= effectiveEndDate)
    .map((item) => ({
      date: item.operationDate,
      document: buildLegacyActTitle(item),
      charged: Number(item.amount),
      paid: 0
    }));

  const advanceRows = [
    ...legacyAdvances.map((advance) => ({
      date: advance.date_value,
      id: advance.id,
      paid: Number(advance.amount)
    })),
    ...advances.map((advance) => ({
      date: normalizeIsoDateValue(advance.payment_date),
      id: advance.id,
      paid: Number(advance.amount)
    }))
  ]
    .sort((left, right) => {
      const leftDate = String(left.date);
      const rightDate = String(right.date);
      return leftDate === rightDate ? String(left.id).localeCompare(String(right.id)) : leftDate.localeCompare(rightDate);
    })
    .map((advance, index) => ({
      date: advance.date,
      document: `Оплата (аванс №${index + 2})`,
      charged: 0,
      paid: advance.paid
    }));

  const rows = [
    ...advanceRows,
    ...acts.map((act) => ({
      date: normalizeIsoDateValue(act.document_date),
      document: act.document_number
        ? `Акт выполненных работ № ${act.document_number} за период с ${formatDateRu(act.period_start)} по ${formatDateRu(act.period_end)}`
        : `Акт выполненных работ за период с ${formatDateRu(act.period_start)} по ${formatDateRu(act.period_end)}`,
      charged: Number(act.total_amount),
      paid: 0
    })),
    ...legacyActs
  ].sort((left, right) => {
    const leftDate = String(left.date);
    const rightDate = String(right.date);

    if (leftDate === rightDate) {
      return left.document.localeCompare(right.document);
    }

    return leftDate.localeCompare(rightDate);
  });

  const chargedTotal = Number(rows.reduce((sum, row) => sum + row.charged, 0).toFixed(2));
  const paidTotal = Number(rows.reduce((sum, row) => sum + row.paid, 0).toFixed(2));
  const closingBalance = Number((openingBalance + paidTotal - chargedTotal).toFixed(2));

  let closingText = `Сальдо на конец периода: ${formatAmount(closingBalance)} руб.`;
  if (closingBalance === 0) {
    closingText = "Сальдо на конец периода: 0,00 руб. Задолженность отсутствует.";
  } else if (closingBalance > 0) {
    closingText = `Сальдо на конец периода: ${formatAmount(closingBalance)} руб. в пользу Заказчика.`;
  } else {
    closingText = `Сальдо на конец периода: ${formatAmount(Math.abs(closingBalance))} руб. задолженность Заказчика перед Исполнителем.`;
  }

  return {
    periodStart: effectiveStartDate,
    periodEnd: effectiveEndDate,
    openingBalance,
    chargedTotal,
    paidTotal,
    closingBalance,
    closingText,
    note: "",
    rows,
    describePeriod: `${formatDateRu(effectiveStartDate)} - ${formatDateRu(effectiveEndDate)}`
  };
}

module.exports = {
  buildReconciliationData,
  getBalanceSummary,
  getLedgerRows,
  getLegacyJournalEntry,
  getReconciliationPeriodBounds,
  getUnsignedPreviousMonthActCandidate,
  getYearlyMonthlyTotals
};
