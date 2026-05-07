const { formatDateRu, isFullMonthPeriod, monthYearLabel } = require("../utils/dateHelpers");

const LEGACY_ADVANCES = Object.freeze([
  Object.freeze({
    key: "legacy-advance-2025-10-23",
    date: "2025-10-23",
    amount: 15000,
    comment: "Аванс от Railship"
  })
]);

const LEGACY_MEAL_CHARGES = Object.freeze([
  Object.freeze({
    key: "legacy-meal-2025-10",
    startDate: "2025-10-01",
    endDate: "2025-10-31",
    amount: 6700,
    documentDate: "2025-11-17",
    documentNumber: "2",
    operationDate: "2025-11-17",
    month: 10,
    year: 2025,
    buttonLabel: "Окт. 25"
  }),
  Object.freeze({
    key: "legacy-meal-2025-11-2026-02",
    startDate: "2025-11-01",
    endDate: "2026-02-28",
    amount: 6100,
    documentDate: "2026-03-06",
    documentNumber: "3",
    operationDate: "2026-03-06",
    buttonLabel: "Ноя.25 - фев.26"
  })
]);

function isWithinRange(date, startDate = null, endDate = null) {
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function periodFullyContained(item, startDate = null, endDate = null) {
  return (!startDate || item.startDate >= startDate) && (!endDate || item.endDate <= endDate);
}

function periodIntersectsYear(item, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return item.startDate <= yearEnd && item.endDate >= yearStart;
}

function buildMealChargeDescription(item, serviceName = "Организация питания сотрудников") {
  if (isFullMonthPeriod(item.startDate, item.endDate)) {
    const month = Number(String(item.startDate).slice(5, 7));
    const year = Number(String(item.startDate).slice(0, 4));
    return `${serviceName} за ${monthYearLabel(month, year)}`;
  }

  return `${serviceName} за период с ${formatDateRu(item.startDate)} по ${formatDateRu(item.endDate)}`;
}

function buildLegacyActTitle(item) {
  const periodText = buildMealChargeDescription(item).replace(/^Организация питания сотрудников\s*/u, "").trim();
  return `Акт выполненных работ № ${item.documentNumber} ${periodText}`;
}

function getLegacyAdvanceRows({ startDate = null, endDate = null } = {}) {
  return LEGACY_ADVANCES
    .filter((item) => isWithinRange(item.date, startDate, endDate))
    .map((item) => ({
      id: item.key,
      operation_type: "legacy_advance",
      date_value: item.date,
      amount: item.amount,
      comment: item.comment,
      employee_name: null,
      is_legacy: true,
      title: "Аванс",
      description: item.comment
    }));
}

function getLegacyMealChargeRows({ startDate = null, endDate = null } = {}) {
  return LEGACY_MEAL_CHARGES
    .filter((item) => periodFullyContained(item, startDate, endDate))
    .map((item) => ({
      id: item.key,
      operation_type: "legacy_meal",
      date_value: item.operationDate,
      amount: item.amount,
      comment: buildMealChargeDescription(item),
      employee_name: null,
      is_legacy: true,
      title: "Питание",
      description: buildMealChargeDescription(item),
      document_number: item.documentNumber,
      document_date: item.documentDate,
      period_start: item.startDate,
      period_end: item.endDate
    }));
}

function getLegacyMealChargesForReconciliation(documentDate = null) {
  return LEGACY_MEAL_CHARGES.filter((item) => !documentDate || item.operationDate <= documentDate);
}

function getLegacyAdvanceTotal() {
  return LEGACY_ADVANCES.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getLegacyMealTotal() {
  return LEGACY_MEAL_CHARGES.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getLegacyMaxActNumber() {
  return LEGACY_MEAL_CHARGES.reduce((maxNumber, item) => {
    const numericNumber = Number(item.documentNumber);
    return Number.isFinite(numericNumber) ? Math.max(maxNumber, numericNumber) : maxNumber;
  }, 0);
}

function getLegacyYearlyTotals(year) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    advanceTotal: 0,
    mealTotal: 0
  }));

  LEGACY_ADVANCES.forEach((item) => {
    if (String(item.date).startsWith(`${year}-`)) {
      const monthIndex = Number(String(item.date).slice(5, 7)) - 1;
      if (months[monthIndex]) {
        months[monthIndex].advanceTotal += Number(item.amount || 0);
      }
    }
  });

  const extraPeriods = [];

  LEGACY_MEAL_CHARGES.forEach((item) => {
    if (isFullMonthPeriod(item.startDate, item.endDate) && String(item.startDate).startsWith(`${year}-`)) {
      const monthIndex = Number(String(item.startDate).slice(5, 7)) - 1;
      if (months[monthIndex]) {
        months[monthIndex].mealTotal += Number(item.amount || 0);
      }
      return;
    }

    if (periodIntersectsYear(item, year)) {
      extraPeriods.push({
        key: item.key,
        label: item.buttonLabel,
        advanceTotal: 0,
        mealTotal: Number(item.amount || 0),
        periodStart: item.startDate,
        periodEnd: item.endDate
      });
    }
  });

  return { months, extraPeriods };
}

function getLegacyActSummary(startDate, endDate) {
  const matching = LEGACY_MEAL_CHARGES.filter((item) => periodFullyContained(item, startDate, endDate));
  return {
    totalAmount: matching.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    daysCount: matching.length ? null : 0,
    entriesCount: matching.length,
    hasLegacyData: matching.length > 0,
    periods: matching
  };
}

function getLegacyJournalEntry(entryId) {
  const advance = LEGACY_ADVANCES.find((item) => item.key === entryId);
  if (advance) {
    return {
      id: advance.key,
      type: "advance",
      title: "Аванс",
      date: advance.date,
      amount: advance.amount,
      description: advance.comment
    };
  }

  const meal = LEGACY_MEAL_CHARGES.find((item) => item.key === entryId);
  if (!meal) {
    return null;
  }

  return {
    id: meal.key,
    type: "meal",
    title: "Питание",
    date: meal.operationDate,
    amount: meal.amount,
    description: buildMealChargeDescription(meal),
    documentNumber: meal.documentNumber,
    documentDate: meal.documentDate,
    periodStart: meal.startDate,
    periodEnd: meal.endDate
  };
}

module.exports = {
  buildMealChargeDescription,
  buildLegacyActTitle,
  getLegacyActSummary,
  getLegacyAdvanceRows,
  getLegacyAdvanceTotal,
  getLegacyJournalEntry,
  getLegacyMaxActNumber,
  getLegacyMealChargeRows,
  getLegacyMealChargesForReconciliation,
  getLegacyMealTotal,
  getLegacyYearlyTotals
};
