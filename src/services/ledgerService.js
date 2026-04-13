const pool = require("../db/pool");
const { formatDateRu, todayIso } = require("../utils/dateHelpers");
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

async function getReconciliationPeriodBounds(documentDate = todayIso()) {
  const normalizedDocumentDate = documentDate || todayIso();
  const legacyStartDateCandidates = [
    ...getLegacyAdvanceRows({ endDate: normalizedDocumentDate }).map((item) => item.date_value),
    ...getLegacyMealChargesForReconciliation(normalizedDocumentDate).map((item) => item.operationDate)
  ].sort();

  const { rows } = await pool.query(
    `
      WITH effective_acts AS (
        SELECT DISTINCT ON (act_year, act_month)
          document_date
        FROM generated_documents
        WHERE doc_type = 'act'
          AND signed_file_path IS NOT NULL
          AND document_date <= $1
        ORDER BY act_year, act_month, uploaded_signed_at DESC NULLS LAST, id DESC
      )
      SELECT MIN(operation_date) AS start_date
      FROM (
        SELECT payment_date AS operation_date
        FROM advances
        WHERE payment_date <= $1
        UNION ALL
        SELECT document_date AS operation_date
        FROM effective_acts
      ) history
    `,
    [normalizedDocumentDate]
  );

  const dbStartDate = rows[0]?.start_date || null;
  const legacyStartDate = legacyStartDateCandidates[0] || null;
  const startDate = [dbStartDate, legacyStartDate].filter(Boolean).sort()[0] || normalizedDocumentDate;

  return {
    startDate,
    endDate: normalizedDocumentDate
  };
}

async function buildReconciliationData({ startDate = null, endDate = null, documentDate = todayIso() }) {
  const defaultPeriod = await getReconciliationPeriodBounds(documentDate);
  const effectiveStartDate = startDate || defaultPeriod.startDate;
  const effectiveEndDate = endDate || defaultPeriod.endDate;
  const legacyMaxActNumber = getLegacyMaxActNumber();

  const openingRows = await pool.query(
      `
        WITH effective_acts AS (
          SELECT DISTINCT ON (period_start::DATE, period_end::DATE)
            document_date,
            total_amount
          FROM generated_documents
          WHERE doc_type = 'act'
            AND signed_file_path IS NOT NULL
          ORDER BY period_start::DATE, period_end::DATE, uploaded_signed_at DESC NULLS LAST, id DESC
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
    [effectiveStartDate]
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
        WITH effective_acts AS (
          SELECT
            signed_acts.document_date,
            canonical_numbers.document_number,
            signed_acts.total_amount,
            signed_acts.period_start,
            signed_acts.period_end
          FROM (
            SELECT DISTINCT ON (period_start::DATE, period_end::DATE)
              document_date,
              total_amount,
              period_start::DATE AS period_start,
              period_end::DATE AS period_end
            FROM generated_documents
            WHERE doc_type = 'act'
              AND signed_file_path IS NOT NULL
            ORDER BY period_start::DATE, period_end::DATE, uploaded_signed_at DESC NULLS LAST, id DESC
          ) signed_acts
          JOIN (
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
          ON canonical_numbers.period_start = signed_acts.period_start
            AND canonical_numbers.period_end = signed_acts.period_end
        )
        SELECT document_date, document_number, total_amount, period_start, period_end
        FROM effective_acts
        WHERE document_date BETWEEN $1 AND $2
        ORDER BY document_date ASC, document_number ASC
      `,
      [effectiveStartDate, effectiveEndDate, legacyMaxActNumber]
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
      date: advance.payment_date,
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
      date: act.document_date,
      document: `Акт выполненных работ № ${act.document_number} за период с ${formatDateRu(act.period_start)} по ${formatDateRu(act.period_end)}`,
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
  getYearlyMonthlyTotals
};
