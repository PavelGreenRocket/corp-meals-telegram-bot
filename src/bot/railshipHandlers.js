const path = require("path");
const { Input, Markup } = require("telegraf");
const config = require("../config");
const { DAILY_LIMIT, DOCUMENT_TYPES, USER_ROLES } = require("../constants");
const { attachAdvanceDocument, createAdvance, deleteAdvance, getAdvanceById, listAdvances, updateAdvance } = require("../services/advanceService");
const { countEmployeeMeals, createEmployee, deleteEmployee, getEmployeeById, listEmployees, listRecentEmployees, toggleEmployeeActive, updateEmployee } = require("../services/employeeService");
const {
  attachSignedDocument,
  generateMonthlyAct,
  generateReconciliationDocument,
  getDocumentById,
  getMonthDocuments,
  hasDocumentsInYear,
  listDocuments,
  markDocumentSent
} = require("../services/documentService");
const {
  getBalanceSummary,
  getLedgerRows,
  getReconciliationPeriodBounds,
  getUnsignedPreviousMonthActCandidate,
  getYearlyMonthlyTotals
} = require("../services/ledgerService");
const { createMealEntry, deleteMealEntry, getEmployeeSpentForDate, getMealEntryById, getMealSummary, listMealEntries, updateMealEntry } = require("../services/mealService");
const { getMonthUploadedDocument, upsertMonthUploadedDocument } = require("../services/monthDocumentService");
const { getCustomerDetails, getPerformerDetails, updateCustomerDetails, updatePerformerDetails } = require("../services/settingsService");
const { getUserById, listUsers, toggleUserActive, updateUserRsSettings, upsertUser, updateUserRole } = require("../services/userService");
const { backHomeKeyboard, datePresetKeyboard, mainMenu, rolePreviewKeyboard } = require("./ui");
const { parseAmount, formatAmount } = require("../utils/money");
const {
  endOfCurrentMonth,
  formatDateRu,
  formatDateShort,
  getMonthRange,
  monthNameRu,
  monthYearLabel,
  normalizeMonthYearInput,
  parseDateInput,
  parsePeriodInput,
  startOfCurrentMonth,
  todayIso,
  yesterdayIso
} = require("../utils/dateHelpers");
const { abbreviateFullName, formatAdvanceRowButton, formatMealRowButton } = require("../utils/display");
const { buildFilePath, downloadFile, ensureDir } = require("../utils/files");

const PAGE_SIZE = 8;
const QUICK_MEAL_AMOUNTS = [100, 150, 200, 250, 300];
const REPORT_SCREENS = {
  ROOT: "root",
  JOURNAL: "journal",
  SUMMARY: "summary"
};
const MONTH_SHORT_LABELS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const SETTINGS_FIELDS = [
  { key: "shortName", label: "Краткое имя" },
  { key: "legalName", label: "Юр. имя" },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП" },
  { key: "address", label: "Адрес" },
  { key: "bankAccount", label: "Р/с" },
  { key: "bankName", label: "Банк" },
  { key: "bik", label: "БИК" },
  { key: "correspondentAccount", label: "К/с" },
  { key: "signerName", label: "Подписант" },
  { key: "signerLabel", label: "Подпись" }
];

function getCurrentMonthYear() {
  const [year, month] = startOfCurrentMonth().split("-").map(Number);
  return { month, year };
}

function ensureSession(ctx) {
  if (!ctx.session) {
    ctx.session = {};
  }

  if (!ctx.session.flow) {
    ctx.session.flow = null;
  }

  if (!ctx.session.customPeriods) {
    ctx.session.customPeriods = {};
  }

  if (!ctx.session.previewRole) {
    ctx.session.previewRole = null;
  }

  if (!ctx.session.reportMonth) {
    ctx.session.reportMonth = getCurrentMonthYear();
  }

  if (!ctx.session.reportPickerYear) {
    ctx.session.reportPickerYear = ctx.session.reportMonth.year;
  }
}

function currentFlow(ctx) {
  ensureSession(ctx);
  return ctx.session.flow;
}

function setFlow(ctx, name, step, data = {}) {
  ensureSession(ctx);
  ctx.session.flow = { name, step, data };
}

function clearFlow(ctx) {
  ensureSession(ctx);
  ctx.session.flow = null;
}

function isActualOwner(ctx) {
  return ctx.state.user?.role === USER_ROLES.OWNER;
}

function getDisplayedRole(ctx) {
  ensureSession(ctx);
  if (isActualOwner(ctx) && ctx.session.previewRole) {
    return ctx.session.previewRole;
  }
  return ctx.state.user?.role || USER_ROLES.CLIENT_VIEWER;
}

function hasDisplayedRole(ctx, ...roles) {
  return roles.includes(getDisplayedRole(ctx));
}

function canManageMealEntry(ctx, meal) {
  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    return true;
  }

  return getDisplayedRole(ctx) === USER_ROLES.BARISTA && meal.created_by_user_id === ctx.state.user.id;
}

function getSelectedReportMonth(ctx) {
  ensureSession(ctx);
  return ctx.session.reportMonth;
}

function setSelectedReportMonth(ctx, month, year) {
  ensureSession(ctx);
  ctx.session.reportMonth = { month, year };
  ctx.session.reportPickerYear = year;
}

function getSelectedReportFilter(ctx) {
  const { month, year } = getSelectedReportMonth(ctx);
  return getMonthRange(month, year);
}

function getSelectedReportMonthLabel(ctx) {
  const { month, year } = getSelectedReportMonth(ctx);
  return monthYearLabel(month, year);
}

function getCompactReportMonthLabel(month, year) {
  return `${MONTH_SHORT_LABELS[month - 1]}. ${String(year).slice(-2)}`;
}

function getShortMonthYearLabel(month, year) {
  const label = MONTH_SHORT_LABELS[month - 1];
  return label ? `${label} ${String(year).slice(-2)}` : `${month}.${String(year).slice(-2)}`;
}

function getActMonthButtonLabel(month, year) {
  const label = monthNameRu(month);
  if (!label) {
    return `${month}.${year}`;
  }
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${year}`;
}

function getAdjacentMonth(month, year, delta) {
  const date = new Date(year, month - 1 + delta, 1);
  return {
    month: date.getMonth() + 1,
    year: date.getFullYear()
  };
}

async function reportMonthHasData(month, year) {
  const filter = getMonthRange(month, year);
  const rows = await getLedgerRows(filter);
  return rows.length > 0;
}

function buildReportMonthRow(ctx, screen) {
  const { month, year } = getSelectedReportMonth(ctx);
  return [
    Markup.button.callback("←", `report:month:shift:${screen}:-1`),
    Markup.button.callback(getCompactReportMonthLabel(month, year), `report:monthpicker:${screen}`),
    Markup.button.callback("→", `report:month:shift:${screen}:1`)
  ];
}

function formatPerformerShortName(details) {
  const shortName = String(details?.shortName || "").trim();
  if (/^ИП\s+/i.test(shortName)) {
    const parts = shortName.replace(/^ИП\s+/i, "").split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      return `ИП ${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
    }
  }

  const signerLabel = String(details?.signerLabel || "")
    .replace(/\//g, "")
    .replace(/_/g, "")
    .trim();
  if (signerLabel) {
    return shortName.startsWith("ИП") ? `ИП ${signerLabel}` : signerLabel;
  }

  return shortName || String(details?.legalName || "Исполнитель");
}

function getSaldoParty(balance, performerDetails, customerDetails) {
  if (balance > 0) {
    return String(customerDetails?.shortName || customerDetails?.legalName || "Заказчик");
  }

  if (balance < 0) {
    return formatPerformerShortName(performerDetails);
  }

  return null;
}

function buildSaldoLines(balance, dateLabel, performerDetails, customerDetails) {
  const amount = Number(balance);
  const lines = [`<b>Сальдо на ${escapeHtml(dateLabel)}:</b>`];

  if (amount === 0) {
    lines.push(`<b>${moneyHtml(0)}</b>`);
    return lines;
  }

  const party = getSaldoParty(amount, performerDetails, customerDetails);
  lines.push(`<b>${moneyHtml(Math.abs(amount))}</b> в пользу ${escapeHtml(party)}`);
  return lines;
}

function buildClientDashboardFooter(ctx) {
  const rows = [];

  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.push([Markup.button.callback("📄 Создать документ", "doc:create_menu")]);
    rows.push([Markup.button.callback("🔙", "nav:home"), Markup.button.callback("🔄 Обновить", "client:home:refresh")]);
    return rows;
  }

  rows.push([Markup.button.callback("🔄 Обновить", "client:home:refresh")]);
  return rows;
}

function buildClientMonthFooter(month, year) {
  return [
    Markup.button.callback("🔙", "client:home"),
    Markup.button.callback("🔄", `client:month:refresh:${year}:${month}`)
  ];
}

function buildClientJournalFooter(month, year) {
  return [
    Markup.button.callback("🔙", `client:month:open:${year}:${month}`),
    Markup.button.callback("🔄", `client:journal:refresh:${year}:${month}`)
  ];
}

function formatClientAmountLabel(amount, config = {}) {
  const { zeroAsDash = false } = config;
  const value = Number(amount || 0);
  if (zeroAsDash && value === 0) {
    return "-";
  }

  const formatOptions = Number.isInteger(value)
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };

  return new Intl.NumberFormat("ru-RU", formatOptions).format(value);
}

function formatClientMealAmountLabel(amount) {
  const value = Number(amount || 0);
  if (value === 0) {
    return "-";
  }

  return `📄 ${formatClientAmountLabel(value)}`;
}

function getMonthShortButtonLabel(month) {
  const label = MONTH_SHORT_LABELS[month - 1] || "";
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : String(month);
}

function buildClientYearRow(ctx) {
  const { year } = getSelectedReportMonth(ctx);
  return [
    Markup.button.callback("←", "client:year:shift:-1"),
    Markup.button.callback(String(year), "noop"),
    Markup.button.callback("→", "client:year:shift:1")
  ];
}

function buildClientMonthRow(ctx, screen = "hub") {
  const { month, year } = getSelectedReportMonth(ctx);
  return [
    Markup.button.callback("←", `client:month:${screen}:shift:-1`),
    Markup.button.callback(getCompactReportMonthLabel(month, year), "noop"),
    Markup.button.callback("→", `client:month:${screen}:shift:1`)
  ];
}

function hasAnyYearTotals(months) {
  return months.some((item) => Number(item.advanceTotal) > 0 || Number(item.mealTotal) > 0);
}

function hasAnyLegacyPeriods(extraPeriods = []) {
  return extraPeriods.some((item) => Number(item.advanceTotal) > 0 || Number(item.mealTotal) > 0);
}

function getAdjacentYear(year, delta) {
  return year + delta;
}

function isClientDashboardMonthVisible(month, year) {
  const { month: currentMonth, year: currentYear } = getCurrentMonthYear();
  if (year < currentYear) {
    return true;
  }

  if (year > currentYear) {
    return false;
  }

  return month <= currentMonth;
}

function hasClientDashboardMonthTotals(item) {
  return Number(item.advanceTotal || 0) > 0 || Number(item.mealTotal || 0) > 0;
}

async function clientYearHasData(year) {
  const [yearTotals, hasDocuments] = await Promise.all([
    getYearlyMonthlyTotals(year),
    hasDocumentsInYear(year)
  ]);
  return hasAnyYearTotals(yearTotals.months) || hasAnyLegacyPeriods(yearTotals.extraPeriods) || hasDocuments;
}

async function clientMonthHasData(month, year) {
  const [{ startDate, endDate }, documents] = await Promise.all([
    Promise.resolve(getMonthRange(month, year)),
    getMonthDocuments(month, year)
  ]);
  const [summary, advances] = await Promise.all([
    getMealSummary({ startDate, endDate }),
    listAdvances({ startDate, endDate, limit: 1, offset: 0 })
  ]);

  return summary.totalAmount > 0 || advances.length > 0 || Boolean(documents.act || documents.reconciliation);
}

function getMonthStatusIcon(document) {
  return document ? "📥" : "(пусто)";
}

function buildReportMonthPickerKeyboard(ctx, screen) {
  ensureSession(ctx);
  const year = ctx.session.reportPickerYear;
  const rows = [
    [
      Markup.button.callback("←", `report:month:year:${screen}:${year - 1}`),
      Markup.button.callback(String(year), "noop"),
      Markup.button.callback("→", `report:month:year:${screen}:${year + 1}`)
    ]
  ];

  for (let start = 0; start < 12; start += 3) {
    rows.push(
      MONTH_SHORT_LABELS.slice(start, start + 3).map((label, index) => {
        const month = start + index + 1;
        return Markup.button.callback(label, `report:month:set:${screen}:${year}:${month}`);
      })
    );
  }

  rows.push([Markup.button.callback("🔙", `report:month:back:${screen}`)]);
  return buildRowsKeyboard(rows);
}

async function openReportScreen(ctx, screen, page = 0) {
  if (screen === REPORT_SCREENS.JOURNAL) {
    await showJournal(ctx, page);
    return;
  }

  if (screen === REPORT_SCREENS.SUMMARY) {
    await showMonthlyMealsSummary(ctx);
    return;
  }

  await sendReportsSection(ctx);
}

async function showReportMonthPicker(ctx, screen) {
  const { year } = getSelectedReportMonth(ctx);
  ctx.session.reportPickerYear = ctx.session.reportPickerYear || year;

  await renderScreen(
    ctx,
    buildHtmlScreen("Выбор месяца", "Выберите месяц для отчётов", [
      lineHtml("Текущий выбор", getSelectedReportMonthLabel(ctx)),
      lineHtml("Год", ctx.session.reportPickerYear)
    ]),
    buildReportMonthPickerKeyboard(ctx, screen)
  );
}

function buildRowsKeyboard(rows) {
  return Markup.inlineKeyboard(rows);
}

function buildActMonthChoiceKeyboard() {
  const current = getCurrentMonthYear();
  const previous = getAdjacentMonth(current.month, current.year, -1);

  return buildRowsKeyboard([
    [
      Markup.button.callback(getActMonthButtonLabel(previous.month, previous.year), `doc:act:month:${previous.year}:${previous.month}`),
      Markup.button.callback(getActMonthButtonLabel(current.month, current.year), `doc:act:month:${current.year}:${current.month}`)
    ],
    [Markup.button.callback("Другой диапазон", "doc:act:month:custom")],
    [Markup.button.callback("🔙", "nav:reports")]
  ]);
}

function buildReconciliationPeriodChoiceKeyboard() {
  const current = getCurrentMonthYear();
  const previous = getAdjacentMonth(current.month, current.year, -1);

  return buildRowsKeyboard([
    [
      Markup.button.callback(getActMonthButtonLabel(previous.month, previous.year), `doc:reconciliation:month:${previous.year}:${previous.month}`),
      Markup.button.callback(getActMonthButtonLabel(current.month, current.year), `doc:reconciliation:month:${current.year}:${current.month}`)
    ],
    [Markup.button.callback("Другой диапазон", "doc:reconciliation:custom")],
    [Markup.button.callback("🔙", "doc:create_menu")]
  ]);
}

function getDocumentMonthPeriod(preset = "current") {
  const current = getCurrentMonthYear();
  const selected = preset === "previous"
    ? getAdjacentMonth(current.month, current.year, -1)
    : current;
  const { startDate, endDate } = getMonthRange(selected.month, selected.year);

  return {
    month: selected.month,
    year: selected.year,
    startDate,
    endDate,
    selectedPreset: preset
  };
}

async function getDefaultDocumentFlowData(kind, options = {}) {
  if (kind === "reconciliation") {
    const includeUnsignedPreviousMonth = Boolean(options.includeUnsignedPreviousMonth);
    const period = await getReconciliationPeriodBounds(todayIso(), { includeUnsignedPreviousMonth });
    return {
      ...period,
      includeUnsignedPreviousMonth,
      pendingUnsignedPreviousMonth: options.pendingUnsignedPreviousMonth || null,
      selectedPreset: "all"
    };
  }

  return getDocumentMonthPeriod("current");
}

function getIsoDateParts(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  return { day, month, year };
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function toIsoDate(parts) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const maxDay = getDaysInMonth(year, month);
  const day = Math.min(Number(parts.day), maxDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatPickerSegment(value, suffix = "") {
  return `${String(value).padStart(2, "0")}${suffix}`;
}

function formatPickerYearShort(year) {
  return String(year).slice(-2);
}

function updateDocumentPeriodPart(state, target, part, value) {
  const next = {
    ...state,
    selectedPreset: "custom"
  };
  const dateKey = target === "start" ? "startDate" : "endDate";
  const dateParts = getIsoDateParts(next[dateKey]);
  dateParts[part] = Number(value);
  next[dateKey] = toIsoDate(dateParts);

  if (next.startDate > next.endDate) {
    if (target === "start") {
      next.endDate = next.startDate;
    } else {
      next.startDate = next.endDate;
    }
  }

  return next;
}

function buildDocumentPeriodKeyboard(kind, state) {
  if (kind === "reconciliation") {
    return buildRowsKeyboard([
      [Markup.button.callback("✅ Сформировать", "doc:reconciliation:apply")],
      [Markup.button.callback("🔙", "doc:create_menu")]
    ]);
  }

  const previousSelected = state.selectedPreset === "previous";
  const currentSelected = state.selectedPreset === "current";
  const monthPrefix = kind === "act" ? "doc:act:month" : "doc:reconciliation:month";
  const pickPrefix = kind === "act" ? "doc:act:pick" : "doc:reconciliation:pick";
  const applyCallback = kind === "act" ? "doc:act:apply" : "doc:reconciliation:apply";
  const start = getIsoDateParts(state.startDate);
  const end = getIsoDateParts(state.endDate);

  return buildRowsKeyboard([
    [
      Markup.button.callback(previousSelected ? "Прошлый (выбрано)" : "Выбрать прошлый", `${monthPrefix}:previous`),
      Markup.button.callback(currentSelected ? "Текущий (выбрано)" : "Выбрать текущий", `${monthPrefix}:current`)
    ],
    [
      Markup.button.callback(formatPickerSegment(start.day, "."), `${pickPrefix}:start:day`),
      Markup.button.callback(formatPickerSegment(start.month, "."), `${pickPrefix}:start:month`),
      Markup.button.callback(formatPickerYearShort(start.year), `${pickPrefix}:start:year`),
      Markup.button.callback("—", "noop"),
      Markup.button.callback(formatPickerSegment(end.day, "."), `${pickPrefix}:end:day`),
      Markup.button.callback(formatPickerSegment(end.month, "."), `${pickPrefix}:end:month`),
      Markup.button.callback(formatPickerYearShort(end.year), `${pickPrefix}:end:year`)
    ],
    [Markup.button.callback("✅ Сформировать", applyCallback)],
    [Markup.button.callback("🔙", "doc:create_menu")]
  ]);
}

function buildUnsignedPreviousMonthChoiceKeyboard(candidate) {
  const monthLabel = `${monthNameRu(candidate.month)} ${candidate.year}`;
  return buildRowsKeyboard([
    [Markup.button.callback("Включить только подписанные", "doc:reconciliation:unsigned_previous:strict")],
    [
      Markup.button.callback(
        `Включить ${monthLabel}`,
        "doc:reconciliation:unsigned_previous:include"
      )
    ],
    [Markup.button.callback("🔙", "doc:create_menu")]
  ]);
}

async function showReconciliationStartScreen(ctx) {
  const candidate = await getUnsignedPreviousMonthActCandidate(todayIso());
  if (!candidate) {
    await showDocumentPeriodScreen(ctx, "reconciliation");
    return;
  }

  setFlow(ctx, "doc:reconciliation:unsigned_previous_month", "choice", {
    pendingUnsignedPreviousMonth: candidate
  });

  await renderScreen(
    ctx,
    buildHtmlScreen(
      "Акт сверки",
      `За ${monthYearLabel(candidate.month, candidate.year)} есть начисления, но подписанный акт вып. работ не загружен`,
      [
        lineHtml("Период", `${formatDateRu(candidate.startDate)} - ${formatDateRu(candidate.endDate)}`),
        lineHtml("Начисления", `${formatAmount(candidate.totalAmount)} руб.`),
        "",
        "<u>Как формируем акт сверки?</u>"
      ]
    ),
    buildUnsignedPreviousMonthChoiceKeyboard(candidate)
  );
}

async function showDocumentPeriodScreen(ctx, kind, state = null) {
  const flowName = kind === "act" ? "doc:act" : "doc:reconciliation";
  const data = state || await getDefaultDocumentFlowData(kind);
  setFlow(ctx, flowName, "period", data);
  const lines = [
    lineHtml("Период", `${formatDateRu(data.startDate)} - ${formatDateRu(data.endDate)}`)
  ];

  if (kind === "reconciliation" && data.pendingUnsignedPreviousMonth) {
    const pending = data.pendingUnsignedPreviousMonth;
    lines.push(lineHtml(
      "Расчёт",
      data.includeUnsignedPreviousMonth
        ? `включён ${monthYearLabel(pending.month, pending.year)} без подписанного акта`
        : "только подписанные акты"
    ));
  }

  await renderScreen(
    ctx,
    buildHtmlScreen(
      kind === "act" ? "Сформировать акт выполненных работ" : "Сформировать акт сверки",
      kind === "act" ? "Выберите месяц" : "Проверьте период перед формированием",
      lines
    ),
    buildDocumentPeriodKeyboard(kind, data)
  );
}

async function showDocumentPartPicker(ctx, kind, target, part) {
  const flowName = kind === "act" ? "doc:act" : "doc:reconciliation";
  const flow = currentFlow(ctx);
  const state = flow?.name === flowName ? flow.data : await getDefaultDocumentFlowData(kind);
  setFlow(ctx, flowName, "period", { ...state, picker: { target, part } });
  const callbackPrefix = kind === "act" ? "doc:act:set" : "doc:reconciliation:set";
  const backCallback = kind === "act" ? "doc:act:picker" : "doc:reconciliation:picker";
  const activeDate = getIsoDateParts(target === "start" ? state.startDate : state.endDate);
  const rows = [];

  if (part === "day") {
    const maxDay = getDaysInMonth(activeDate.year, activeDate.month);
    for (let day = 1; day <= maxDay; day += 1) {
      const label = day === activeDate.day ? `[${formatPickerSegment(day)}]` : formatPickerSegment(day);
      const rowIndex = Math.floor((day - 1) / 7);
      rows[rowIndex] = rows[rowIndex] || [];
      rows[rowIndex].push(Markup.button.callback(label, `${callbackPrefix}:${target}:day:${day}`));
    }
  } else if (part === "month") {
    for (let month = 1; month <= 12; month += 1) {
      const label = month === activeDate.month ? `[${formatPickerSegment(month)}]` : formatPickerSegment(month);
      const rowIndex = Math.floor((month - 1) / 4);
      rows[rowIndex] = rows[rowIndex] || [];
      rows[rowIndex].push(Markup.button.callback(label, `${callbackPrefix}:${target}:month:${month}`));
    }
  } else {
    const baseYear = activeDate.year;
    const years = Array.from({ length: 9 }, (_, index) => baseYear - 4 + index);
    years.forEach((year, index) => {
      const label = year === activeDate.year ? `[${year}]` : String(year);
      const rowIndex = Math.floor(index / 3);
      rows[rowIndex] = rows[rowIndex] || [];
      rows[rowIndex].push(Markup.button.callback(label, `${callbackPrefix}:${target}:year:${year}`));
    });
  }

  rows.push([Markup.button.callback("🔙", backCallback)]);
  await renderScreen(
    ctx,
    buildHtmlScreen(
      kind === "act" ? "Сформировать акт выполненных работ" : "Сформировать акт сверки",
      `Выберите ${part === "day" ? "день" : part === "month" ? "месяц" : "год"} ${target === "start" ? "начала" : "окончания"} периода`,
      [lineHtml("Период", `${formatDateRu(state.startDate)} - ${formatDateRu(state.endDate)}`)]
    ),
    buildRowsKeyboard(rows)
  );
}

function buildPagedKeyboard(items, labelFn, itemPrefix, page, hasMore, extraRows = [], backData = "nav:home") {
  const rows = items.map((item) => [Markup.button.callback(labelFn(item), `${itemPrefix}:${item.id}`)]);
  const navRow = [];

  if (page > 0) {
    navRow.push(Markup.button.callback("<", `${itemPrefix}:page:${page - 1}`));
  }

  navRow.push(Markup.button.callback(`${page + 1}`, "noop"));

  if (hasMore) {
    navRow.push(Markup.button.callback(">", `${itemPrefix}:page:${page + 1}`));
  }

  if (page > 0 || hasMore) {
    rows.push(navRow);
  }

  rows.push(...extraRows);
  rows.push([Markup.button.callback("🔙", backData)]);

  return buildRowsKeyboard(rows);
}

async function answerCb(ctx, text = null, extra = undefined) {
  if (!ctx.callbackQuery) {
    return;
  }

  ctx.state = ctx.state || {};
  if (ctx.state.callbackAnswered) {
    return;
  }

  if (text !== null) {
    await ctx.answerCbQuery(text || undefined, extra);
    ctx.state.callbackAnswered = true;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function moneyHtml(amount) {
  return `${escapeHtml(formatAmount(amount))}`;
}

function lineHtml(label, value) {
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`;
}

function buildHtmlScreen(title, subtitle = null, lines = []) {
  const parts = [`<b>${escapeHtml(title)}</b>`];
  if (subtitle) {
    parts.push(`<i>${escapeHtml(subtitle)}</i>`);
  }
  if (lines.length) {
    parts.push("", ...lines);
  }
  return parts.join("\n");
}

function getDocumentDownloadMonthYear(document, override = {}) {
  if (override.month && override.year) {
    return { month: Number(override.month), year: Number(override.year) };
  }

  if (document.act_month && document.act_year) {
    return { month: Number(document.act_month), year: Number(document.act_year) };
  }

  const sourceDate = document.doc_type === DOCUMENT_TYPES.RECONCILIATION
    ? document.period_end || document.document_date
    : document.period_start || document.document_date;
  const [year, month] = String(sourceDate || "")
    .split("-")
    .slice(0, 2)
    .map(Number);

  return month && year ? { month, year } : null;
}

function buildDocumentDownloadName(document, signed = false, options = {}) {
  if (signed) {
    const monthYear = getDocumentDownloadMonthYear(document, options);
    if (monthYear) {
      const periodLabel = getShortMonthYearLabel(monthYear.month, monthYear.year);
      const baseName = document.doc_type === DOCUMENT_TYPES.ACT
        ? `Акт вып. работ ${periodLabel}`
        : `Акт сверки ${periodLabel}`;

      return `${baseName} (подписанный).docx`;
    }
  }

  const dateLabel = formatDateShort(document.document_date);
  const baseName = document.doc_type === DOCUMENT_TYPES.ACT
    ? `Акт вып. работ от ${dateLabel}`
    : `Акт сверки от ${dateLabel}`;

  return `${baseName}${signed ? " (подписанный)" : ""}.docx`;
}

async function renderScreen(ctx, html, keyboard = undefined) {
  const extra = {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard || {})
  };

  if (ctx.callbackQuery?.message) {
    ctx.state = ctx.state || {};
    if (!ctx.state?.callbackAnswered) {
      await ctx.answerCbQuery();
      ctx.state.callbackAnswered = true;
    }
    try {
      await ctx.editMessageText(html, extra);
      return;
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("message is not modified")) {
        return;
      }
    }
  }

  await ctx.reply(html, extra);
}

async function sendMainMenu(ctx, note = null) {
  clearFlow(ctx);

  if (getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER) {
    await showClientDashboard(ctx, 0);
    return;
  }

  const [balance, performerDetails, customerDetails] = await Promise.all([
    getBalanceSummary(),
    getPerformerDetails(),
    getCustomerDetails()
  ]);

  const lines = buildSaldoLines(balance.balance, formatDateRu(todayIso()), performerDetails, customerDetails);
  if (note) {
    lines.push(`<i>${escapeHtml(note)}</i>`);
  }
  if (isActualOwner(ctx) && ctx.session.previewRole) {
    lines.push(`<b>Тестовый просмотр:</b> <code>${escapeHtml(ctx.session.previewRole)}</code>`);
  }

  await renderScreen(
    ctx,
    buildHtmlScreen(`Взаиморассчёты Railship & ${formatPerformerShortName(performerDetails)}`, null, lines),
    mainMenu(getDisplayedRole(ctx))
  );
}

async function sendRoleScreen(ctx) {
  const lines = [
    lineHtml("Роль в системе", ctx.state.user.role),
    lineHtml("Отображаемая роль", getDisplayedRole(ctx))
  ];

  if (!isActualOwner(ctx)) {
    lines.push("<i>Переключение доступно только owner.</i>");
    await renderScreen(ctx, buildHtmlScreen("Роль", "Информация о текущем доступе", lines), backHomeKeyboard());
    return;
  }

  lines.push(
    lineHtml("Тестовый режим", ctx.session.previewRole ? ctx.session.previewRole : "выключен")
  );

  await renderScreen(
    ctx,
    buildHtmlScreen("Тест роли", "Выберите режим отображения интерфейса", lines),
    rolePreviewKeyboard()
  );
}

async function sendMealsSection(ctx) {
  const role = getDisplayedRole(ctx);
  const rows = [];

  if (role === USER_ROLES.OWNER || role === USER_ROLES.BARISTA) {
    rows.push([Markup.button.callback("Добавить питание", "meal:add")]);
    rows.push([
      Markup.button.callback("Текущий месяц", role === USER_ROLES.BARISTA ? "meal:list:mine" : "meal:list:month_current"),
      Markup.button.callback("Сегодня", "meal:list:today")
    ]);
    rows.push([Markup.button.callback("Выбрать период", "meal:list:custom")]);
  }

  rows.push([Markup.button.callback("🔙", "nav:home")]);
  await renderScreen(ctx, buildHtmlScreen("Питание", "Быстрые действия по учёту питания"), buildRowsKeyboard(rows));
}

async function sendAdvancesSection(ctx) {
  await renderScreen(
    ctx,
    buildHtmlScreen("Авансы", "Управление оплатами и просмотр истории"),
    buildRowsKeyboard([
      [Markup.button.callback("Добавить аванс", "advance:add")],
      [Markup.button.callback("Текущий месяц", "advance:list:month_current")],
      [Markup.button.callback("Выбрать период", "advance:list:custom")],
      [Markup.button.callback("🔙", "nav:home")]
    ])
  );
}

async function sendReportsSection(ctx) {
  if (getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER) {
    await showClientDashboard(ctx, 0);
    return;
  }

  const rows = [
    buildReportMonthRow(ctx, REPORT_SCREENS.ROOT),
    [Markup.button.callback("Остаток аванса", "report:balance")],
    [Markup.button.callback("Журнал операций", "journal:list")],
    [Markup.button.callback("🔙", "nav:home")]
  ];

  await renderScreen(
    ctx,
    buildHtmlScreen("Отчёты", "Просмотр баланса, журнала и сводок"),
    buildRowsKeyboard(rows)
  );
}

async function sendDocumentsSection(ctx) {
  const rows = [];

  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.push([Markup.button.callback("Сформировать акт", "doc:generate:act")]);
    rows.push([Markup.button.callback("Сформировать сверку", "doc:generate:reconciliation")]);
  }

  rows.push([Markup.button.callback("Архив документов", "doc:list:all")]);
  rows.push([Markup.button.callback("🔙", "nav:home")]);

  await renderScreen(ctx, buildHtmlScreen("Документы", "Формирование и архив документов"), buildRowsKeyboard(rows));
}

async function showDocumentCreateMenu(ctx) {
  await renderScreen(
    ctx,
    buildHtmlScreen("Создать документ", "Выберите тип документа"),
    buildRowsKeyboard([
      [Markup.button.callback("Акт выполненных работ", "doc:generate:act")],
      [Markup.button.callback("Акт сверки", "doc:generate:reconciliation")],
      [Markup.button.callback("Аванс", "doc:advance:add")],
      [Markup.button.callback("🔙", "nav:reports")]
    ])
  );
}

async function sendEmployeesSection(ctx) {
  const rows = [[Markup.button.callback("Список сотрудников", "employee:list:page:0")]];

  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.push([Markup.button.callback("Добавить сотрудника", "employee:add")]);
  }

  rows.push([Markup.button.callback("🔙", "nav:home")]);
  await renderScreen(ctx, buildHtmlScreen("Сотрудники Railship", "Справочник сотрудников"), buildRowsKeyboard(rows));
}

async function sendUsersSection(ctx) {
  await renderScreen(
    ctx,
    buildHtmlScreen("Пользователи бота", "Управление доступами и ролями"),
    buildRowsKeyboard([
      [Markup.button.callback("Список пользователей", "user:list:page:0")],
      [Markup.button.callback("Добавить / обновить", "user:add")],
      [Markup.button.callback("🔙", "nav:home")]
    ])
  );
}

async function sendSettingsSection(ctx) {
  await renderScreen(
    ctx,
    buildHtmlScreen("Настройки", "Служебные разделы управления"),
    buildRowsKeyboard([
      [Markup.button.callback("👤 Пользователи", "nav:users")],
      [Markup.button.callback("📋 Реквизиты сторон", "settings:requisites")],
      [Markup.button.callback("🔙", "nav:home")]
    ])
  );
}

async function showBalance(ctx) {
  const balance = await getBalanceSummary();
  await renderScreen(
    ctx,
    buildHtmlScreen("Баланс Railship", "Текущее состояние взаиморасчётов", [
      `<b>Всего авансов:</b> ${moneyHtml(balance.totalPaid)}`,
      `<b>Всего питания:</b> ${moneyHtml(balance.totalCharged)}`,
      `<b>Остаток аванса:</b> ${moneyHtml(balance.balance)}`
    ]),
    buildRowsKeyboard([[Markup.button.callback("🔙", "nav:reports")]])
  );
}

function getMealListFilter(ctx, mode) {
  if (mode === "today") {
    return { startDate: todayIso(), endDate: todayIso() };
  }

  if (mode === "mine") {
    return {
      startDate: startOfCurrentMonth(),
      endDate: endOfCurrentMonth(),
      createdByUserId: ctx.state.user.id
    };
  }

  if (mode === "custom") {
    return ctx.session.customPeriods.meals || null;
  }

  return { startDate: startOfCurrentMonth(), endDate: endOfCurrentMonth() };
}

function getAdvanceListFilter(ctx, mode) {
  if (mode === "custom") {
    return ctx.session.customPeriods.advances || null;
  }

  return { startDate: startOfCurrentMonth(), endDate: endOfCurrentMonth() };
}

async function showMealList(ctx, mode, page = 0) {
  const filter = getMealListFilter(ctx, mode);
  if (!filter) {
    await renderScreen(ctx, buildHtmlScreen("Питание", "Сначала введите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"), backHomeKeyboard());
    return;
  }

  const entries = await listMealEntries({
    ...filter,
    limit: PAGE_SIZE + 1,
    offset: page * PAGE_SIZE
  });

  const hasMore = entries.length > PAGE_SIZE;
  const visible = entries.slice(0, PAGE_SIZE);

  if (!visible.length) {
    await renderScreen(ctx, buildHtmlScreen("Питание", "За выбранный период записей пока нет"), backHomeKeyboard());
    return;
  }

  const summary = await getMealSummary(filter);
  const rows = visible.map((entry) => [Markup.button.callback(formatMealRowButton(entry), `meal:view:${entry.id}`)]);
  const navRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("<", `meal:listpage:${mode}:${page - 1}`));
  }
  navRow.push(Markup.button.callback(`${page + 1}`, "noop"));
  if (hasMore) {
    navRow.push(Markup.button.callback(">", `meal:listpage:${mode}:${page + 1}`));
  }
  if (page > 0 || hasMore) {
    rows.push(navRow);
  }
  rows.push([Markup.button.callback("Текущий месяц", "meal:list:month_current"), Markup.button.callback("Сегодня", "meal:list:today")]);
  rows.push([Markup.button.callback("Выбрать период", "meal:list:custom")]);
  rows.push([Markup.button.callback("🔙", "nav:meals")]);

  await renderScreen(
    ctx,
    buildHtmlScreen("Питание", "Журнал операций по питанию", [
      `<b>Сумма:</b> ${moneyHtml(summary.totalAmount)}`,
      `<b>Дней питания:</b> ${escapeHtml(summary.daysCount)}`,
      `<b>Записей:</b> ${escapeHtml(summary.entriesCount)}`
    ]),
    buildRowsKeyboard(rows)
  );
}

async function showAdvanceList(ctx, mode, page = 0) {
  const filter = getAdvanceListFilter(ctx, mode);
  if (!filter) {
    await renderScreen(ctx, buildHtmlScreen("Авансы", "Сначала введите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"), backHomeKeyboard());
    return;
  }

  const entries = await listAdvances({
    ...filter,
    limit: PAGE_SIZE + 1,
    offset: page * PAGE_SIZE
  });
  const hasMore = entries.length > PAGE_SIZE;
  const visible = entries.slice(0, PAGE_SIZE);

  if (!visible.length) {
    await renderScreen(ctx, buildHtmlScreen("Авансы", "За выбранный период авансов пока нет"), backHomeKeyboard());
    return;
  }

  const rows = visible.map((entry) => [Markup.button.callback(formatAdvanceRowButton(entry), `advance:view:${entry.id}`)]);
  const navRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("<", `advance:listpage:${mode}:${page - 1}`));
  }
  navRow.push(Markup.button.callback(`${page + 1}`, "noop"));
  if (hasMore) {
    navRow.push(Markup.button.callback(">", `advance:listpage:${mode}:${page + 1}`));
  }
  if (page > 0 || hasMore) {
    rows.push(navRow);
  }
  rows.push([Markup.button.callback("Выбрать период", "advance:list:custom")]);
  rows.push([Markup.button.callback("🔙", "nav:advances")]);

  await renderScreen(ctx, buildHtmlScreen("Авансы", "Список операций по авансам"), buildRowsKeyboard(rows));
}

async function showMonthlyMealsSummary(ctx) {
  const filter = getSelectedReportFilter(ctx);
  const summary = await getMealSummary(filter);

  await renderScreen(
    ctx,
    buildHtmlScreen("Сводка по питанию", null, [
      `<b>Сумма:</b> ${moneyHtml(summary.totalAmount)}`,
      `<b>Дней питания:</b> ${escapeHtml(summary.daysCount)}`,
      `<b>Записей:</b> ${escapeHtml(summary.entriesCount)}`
    ]),
    buildRowsKeyboard([
      buildReportMonthRow(ctx, REPORT_SCREENS.SUMMARY),
      [Markup.button.callback("🔙", "nav:reports")]
    ])
  );
}

async function showJournal(ctx, page = 0) {
  const filter = getSelectedReportFilter(ctx);
  const entries = await getLedgerRows(filter);
  const start = page * PAGE_SIZE;
  const visible = entries.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < entries.length;

  if (!visible.length) {
    await renderScreen(
      ctx,
      buildHtmlScreen("Журнал операций"),
      buildRowsKeyboard([
        buildReportMonthRow(ctx, REPORT_SCREENS.JOURNAL),
        [Markup.button.callback("🔙", "nav:reports")]
      ])
    );
    return;
  }

  const rows = [buildReportMonthRow(ctx, REPORT_SCREENS.JOURNAL)];
  visible.forEach((item) => {
    const callback = `journal:entry:${item.operation_type}:${item.id}:${page}`;
    rows.push([
      Markup.button.callback(formatDateRu(item.date_value), callback),
      Markup.button.callback(item.operation_type === "advance" ? "Аванс" : abbreviateFullName(item.employee_name), callback),
      Markup.button.callback(formatAmount(item.amount), callback)
    ]);
  });

  const navRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("<", `journal:list:page:${page - 1}`));
  }
  navRow.push(Markup.button.callback(`${page + 1}`, "noop"));
  if (hasMore) {
    navRow.push(Markup.button.callback(">", `journal:list:page:${page + 1}`));
  }
  if (page > 0 || hasMore) {
    rows.push(navRow);
  }

  rows.push([Markup.button.callback("🔙", "nav:reports")]);

  await renderScreen(
    ctx,
    buildHtmlScreen("Журнал операций"),
    buildRowsKeyboard(rows)
  );
}

async function showClientDashboard(ctx) {
  const { year } = getSelectedReportMonth(ctx);
  const [balance, performerDetails, customerDetails, yearTotals] = await Promise.all([
    getBalanceSummary(),
    getPerformerDetails(),
    getCustomerDetails(),
    getYearlyMonthlyTotals(year)
  ]);
  const lines = buildSaldoLines(balance.balance, formatDateRu(todayIso()), performerDetails, customerDetails);
  const showEmptyMonths = getDisplayedRole(ctx) === USER_ROLES.OWNER;
  const rows = [
    buildClientYearRow(ctx),
    [
      Markup.button.callback("📅 Дата:", "client:dashboard:header:date"),
      Markup.button.callback("💸 Аванс:", "client:dashboard:header:advance"),
      Markup.button.callback("🍴 Питание:", "client:dashboard:header:meal")
    ]
  ];
  const months = yearTotals.months;
  const dashboardItems = [
    ...months
      .filter((item) => isClientDashboardMonthVisible(item.month, year) && (showEmptyMonths || hasClientDashboardMonthTotals(item)))
      .map((item) => ({
        sortDate: `${year}-${String(item.month).padStart(2, "0")}-01`,
        row: [
          Markup.button.callback(getMonthShortButtonLabel(item.month), `client:month:open:${year}:${item.month}`),
          Markup.button.callback(formatClientAmountLabel(item.advanceTotal, { zeroAsDash: true }), `client:advance:info:${year}:${item.month}`),
          Markup.button.callback(formatClientMealAmountLabel(item.mealTotal), `client:month:open:${year}:${item.month}`)
        ]
      })),
    ...yearTotals.extraPeriods.map((item) => ({
      sortDate: item.periodStart,
      row: [
        Markup.button.callback(item.label, "client:dashboard:legacy_period"),
        Markup.button.callback(formatClientAmountLabel(item.advanceTotal, { zeroAsDash: true }), "client:dashboard:legacy_period"),
        Markup.button.callback(formatClientMealAmountLabel(item.mealTotal), "client:dashboard:legacy_period")
      ]
    }))
  ].sort((left, right) => left.sortDate.localeCompare(right.sortDate));

  dashboardItems.forEach((item) => rows.push(item.row));

  rows.push(...buildClientDashboardFooter(ctx));

  await renderScreen(
    ctx,
    buildHtmlScreen("Взаиморассчёты Railship & ИП Валеев П.С.", null, lines),
    buildRowsKeyboard(rows)
  );
}

async function showClientMonthDetails(ctx, month, year) {
  setSelectedReportMonth(ctx, month, year);
  const [balance, performerDetails, customerDetails, documents] = await Promise.all([
    getBalanceSummary(),
    getPerformerDetails(),
    getCustomerDetails(),
    getMonthDocuments(month, year)
  ]);
  const rows = [buildClientMonthRow(ctx, "hub")];

  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.push([
      Markup.button.callback(
        `${documents.reconciliation?.signed_file_path ? "✅" : "-"} Акт сверки`,
        `client:doc:reconciliation:${year}:${month}`
      ),
      Markup.button.callback(
        documents.reconciliation?.signed_file_path ? "✏️ Изменить" : "📤 Загрузить",
        `client:doc:uploadmonth:reconciliation:${year}:${month}`
      )
    ]);
    rows.push([
      Markup.button.callback(
        `${documents.act?.signed_file_path ? "✅" : "-"} Акт вып. работ`,
        `client:doc:act:${year}:${month}`
      ),
      Markup.button.callback(
        documents.act?.signed_file_path ? "✏️ Изменить" : "📤 Загрузить",
        `client:doc:uploadmonth:act:${year}:${month}`
      )
    ]);
  } else {
    rows.push([
      Markup.button.callback(`${getMonthStatusIcon(documents.reconciliation)} Акт сверки`, `client:doc:reconciliation:${year}:${month}`)
    ]);
    rows.push([
      Markup.button.callback(`${getMonthStatusIcon(documents.act)} Акт вып. работ`, `client:doc:act:${year}:${month}`)
    ]);
  }

  rows.push([Markup.button.callback("📄 Журнал питания", `client:journal:open:${year}:${month}`)]);
  rows.push(buildClientMonthFooter(month, year));

  await renderScreen(
    ctx,
    buildHtmlScreen("Взаиморассчёты Railship & ИП Валеев П.С.", null, [
      ...buildSaldoLines(balance.balance, formatDateRu(todayIso()), performerDetails, customerDetails)
    ]),
    buildRowsKeyboard(rows)
  );
}

async function showClientMonthJournal(ctx, month, year, page = 0) {
  setSelectedReportMonth(ctx, month, year);
  const { startDate, endDate } = getMonthRange(month, year);
  const [balance, performerDetails, customerDetails, summary, entries] = await Promise.all([
    getBalanceSummary(),
    getPerformerDetails(),
    getCustomerDetails(),
    getMealSummary({ startDate, endDate }),
    listMealEntries({ startDate, endDate, limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE })
  ]);
  const visible = entries.slice(0, PAGE_SIZE);
  const hasMore = entries.length > PAGE_SIZE;
  const rows = [buildClientMonthRow(ctx, "journal")];

  if (!visible.length) {
    rows.push([Markup.button.callback("Записей нет", "noop")]);
  } else {
    visible.forEach((item) => {
      rows.push([
        Markup.button.callback(formatDateRu(item.meal_date), `client:meal:view:${item.id}:${year}:${month}:${page}`),
        Markup.button.callback(abbreviateFullName(item.employee_name), `client:meal:view:${item.id}:${year}:${month}:${page}`),
        Markup.button.callback(formatAmount(item.amount), `client:meal:view:${item.id}:${year}:${month}:${page}`)
      ]);
    });
  }

  const navRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback("<", `client:journal:page:${year}:${month}:${page - 1}`));
  }
  navRow.push(Markup.button.callback(`${page + 1}`, "noop"));
  if (hasMore) {
    navRow.push(Markup.button.callback(">", `client:journal:page:${year}:${month}:${page + 1}`));
  }
  if (page > 0 || hasMore) {
    rows.push(navRow);
  }

  rows.push([Markup.button.callback(`Итого питание: ${formatAmount(summary.totalAmount)}`, "noop")]);
  rows.push(buildClientJournalFooter(month, year));

  await renderScreen(
    ctx,
    buildHtmlScreen("Взаиморассчёты Railship & ИП Валеев П.С.", null, [
      ...buildSaldoLines(balance.balance, formatDateRu(todayIso()), performerDetails, customerDetails)
    ]),
    buildRowsKeyboard(rows)
  );
}

async function showEmployeeList(ctx, page = 0) {
  const employees = await listEmployees({ activeOnly: false, limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE });
  const hasMore = employees.length > PAGE_SIZE;
  const visible = employees.slice(0, PAGE_SIZE);
  const backData = getDisplayedRole(ctx) === USER_ROLES.OWNER ? "settings:root" : "nav:home";
  const extraRows = getDisplayedRole(ctx) === USER_ROLES.OWNER
    ? [[Markup.button.callback("➕ Добавить", "employee:add")]]
    : [];

  if (!visible.length) {
    await renderScreen(
      ctx,
      buildHtmlScreen("Сотрудники", "Список пока пуст"),
      buildRowsKeyboard([...extraRows, [Markup.button.callback("🔙", backData)]])
    );
    return;
  }

  await renderScreen(
    ctx,
    buildHtmlScreen("Сотрудники", "Справочник сотрудников Railship"),
    buildPagedKeyboard(
      visible,
      (employee) => `${employee.is_active ? "🟢" : "⚪"} ${employee.full_name}`,
      "employee:view",
      page,
      hasMore,
      extraRows,
      backData
    )
  );
}

async function showUserList(ctx, page = 0) {
  const users = await listUsers();
  const start = page * PAGE_SIZE;
  const visible = users.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < users.length;
  const extraRows = [[Markup.button.callback("➕ Добавить", "user:add")]];

  if (!visible.length) {
    await renderScreen(
      ctx,
      buildHtmlScreen("Пользователи", "Список пока пуст"),
      buildRowsKeyboard([...extraRows, [Markup.button.callback("🔙", "settings:root")]])
    );
    return;
  }

  await renderScreen(
    ctx,
    buildHtmlScreen("Пользователи", "Управление ролями и доступом"),
    buildPagedKeyboard(
      visible,
      (user) => `${user.is_active ? "🟢" : "⚪"} ${user.full_name} | ${getUserRoleDisplay(user)}`,
      "user:view",
      page,
      hasMore,
      extraRows,
      "settings:root"
    )
  );
}

async function showDocumentList(ctx, docType = null, page = 0) {
  const documents = await listDocuments({ docType, limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE });
  const hasMore = documents.length > PAGE_SIZE;
  const visible = documents.slice(0, PAGE_SIZE);

  if (!visible.length) {
    await renderScreen(ctx, buildHtmlScreen("Документы", "Архив пока пуст"), backHomeKeyboard());
    return;
  }

  await renderScreen(
    ctx,
    buildHtmlScreen("Архив документов", "Сформированные и подписанные документы"),
    buildPagedKeyboard(
      visible,
      (doc) =>
        `${doc.doc_type === DOCUMENT_TYPES.ACT ? "Акт" : "Сверка"} | ${formatDateRu(doc.document_date)} | ${doc.status}`,
      "doc:view",
      page,
      hasMore,
      [],
      "nav:documents"
    )
  );
}

async function showMealDetail(ctx, mealId, options = {}) {
  const meal = await getMealEntryById(mealId);
  if (!meal) {
    await renderScreen(ctx, buildHtmlScreen("Питание", "Запись не найдена"), backHomeKeyboard());
    return;
  }

  const spent = await getEmployeeSpentForDate(meal.employee_id, meal.meal_date, meal.id);
  const dailyTotal = Number((spent + Number(meal.amount)).toFixed(2));

  const backData = options.backData || "nav:meals";
  const rows = [[Markup.button.callback("🔙", backData)]];
  if (canManageMealEntry(ctx, meal)) {
    rows.unshift(
      [Markup.button.callback("Сумма", `meal:edit:amount:${meal.id}`), Markup.button.callback("Дата", `meal:edit:date:${meal.id}`)],
      [Markup.button.callback("Сотрудник", `meal:edit:employee:${meal.id}`)],
      [Markup.button.callback("Удалить", `meal:delete:${meal.id}`)]
    );
  }

  const details = [
    lineHtml("Дата", formatDateRu(meal.meal_date)),
    lineHtml("Сотрудник", meal.employee_name),
    `<b>Сумма:</b> ${moneyHtml(meal.amount)}`,
    lineHtml("Создал", meal.creator_name || "-"),
    `<b>Итог за день:</b> ${moneyHtml(dailyTotal)}`,
    `<b>Остаток лимита:</b> ${moneyHtml(Math.max(0, DAILY_LIMIT - dailyTotal))}`
  ];

  if (meal.comment) {
    details.splice(4, 0, lineHtml("Комментарий", meal.comment));
  }

  await renderScreen(ctx, buildHtmlScreen(`Питание #${meal.id}`, "Карточка записи", details), buildRowsKeyboard(rows));
}

async function showAdvanceDetail(ctx, advanceId, options = {}) {
  const advance = await getAdvanceById(advanceId);
  if (!advance) {
    await renderScreen(ctx, buildHtmlScreen("Аванс", "Запись не найдена"), backHomeKeyboard());
    return;
  }

  const backData = options.backData || "nav:advances";
  const rows = [[Markup.button.callback("🔙", backData)]];
  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.unshift(
      [Markup.button.callback("Сумма", `advance:edit:amount:${advance.id}`), Markup.button.callback("Дата", `advance:edit:date:${advance.id}`)],
      [Markup.button.callback("Комментарий", `advance:edit:comment:${advance.id}`)],
      [Markup.button.callback("Удалить", `advance:delete:${advance.id}`)]
    );
  }

  const details = [
    lineHtml("Дата", formatDateRu(advance.payment_date)),
    `<b>Сумма:</b> ${moneyHtml(advance.amount)}`,
    lineHtml("Создал", advance.creator_name || "-")
  ];

  if (advance.comment) {
    details.splice(2, 0, lineHtml("Комментарий", advance.comment));
  }

  await renderScreen(ctx, buildHtmlScreen(`Аванс #${advance.id}`, "Карточка операции", details), buildRowsKeyboard(rows));
}

async function showEmployeeDetail(ctx, employeeId) {
  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    await renderScreen(ctx, buildHtmlScreen("Сотрудник", "Запись не найдена"), backHomeKeyboard());
    return;
  }

  const mealsCount = await countEmployeeMeals(employee.id);
  const rows = [[Markup.button.callback("🔙", "nav:employees")]];
  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.unshift([Markup.button.callback("Изменить имя", `employee:edit:name:${employee.id}`)]);
    rows.unshift([Markup.button.callback(employee.is_active ? "Выключить" : "Включить", `employee:toggle:${employee.id}`)]);
    if (mealsCount === 0) {
      rows.unshift([Markup.button.callback("Удалить", `employee:delete:confirm:${employee.id}`)]);
    }
  }

  const details = [
    lineHtml("Сотрудник", employee.full_name),
    lineHtml("Статус", employee.is_active ? "активен" : "неактивен"),
    lineHtml("Записей питания", mealsCount)
  ];

  if (employee.note) {
    details.push(lineHtml("Комментарий", employee.note));
  }

  await renderScreen(ctx, buildHtmlScreen("Сотрудник", "Карточка сотрудника", details), buildRowsKeyboard(rows));
}

async function showUserDetail(ctx, userId) {
  const user = await getUserById(userId);
  if (!user) {
    await renderScreen(ctx, buildHtmlScreen("Пользователь", "Запись не найдена"), backHomeKeyboard());
    return;
  }
  const mealEmployee = user.employee_id ? await getEmployeeById(user.employee_id) : null;

  const rows = [];
  if (user.company === "GR") {
    rows.push([Markup.button.callback("Изменить роль", `user:role:open:${user.id}`)]);
  } else {
    rows.push([Markup.button.callback(user.receives_meals ? "Выключить питание" : "Включить питание", `user:meals:toggle:${user.id}`)]);
    if (user.receives_meals) {
      rows.push([Markup.button.callback("ФИО для питания", `user:meal_name:${user.id}`)]);
    }
  }
  rows.push([Markup.button.callback(user.is_active ? "Выключить" : "Включить", `user:toggle:${user.id}`)]);
  rows.push([Markup.button.callback("🔙", "user:list:page:0")]);

  await renderScreen(
    ctx,
    buildHtmlScreen("Пользователь", "Карточка пользователя", [
      lineHtml("Имя", user.full_name),
      lineHtml("Telegram ID", user.telegram_id),
      lineHtml("Username", user.username || "-"),
      lineHtml("Компания", getUserCompanyLabel(user.company)),
      lineHtml("Роль", getUserRoleDisplay(user)),
      ...(user.company === "RS"
        ? [
          lineHtml("Питается", user.receives_meals ? "да" : "нет"),
          lineHtml("ФИО для питания", mealEmployee?.full_name || "-")
        ]
        : []),
      lineHtml("Статус", user.is_active ? "активен" : "неактивен")
    ]),
    buildRowsKeyboard(rows)
  );
}

function getSettingsEntityTitle(entity) {
  return entity === "performer" ? "Исполнитель" : "Заказчик";
}

function buildSettingsDetailsLines(details) {
  return SETTINGS_FIELDS.map((field) => lineHtml(field.label, details[field.key] || "-"));
}

function buildSettingsFieldKeyboard(entity) {
  const rows = [];

  for (let index = 0; index < SETTINGS_FIELDS.length; index += 2) {
    rows.push(
      SETTINGS_FIELDS.slice(index, index + 2).map((field) =>
        Markup.button.callback(field.label, `settings:field:${entity}:${field.key}`)
      )
    );
  }

  rows.push([Markup.button.callback("🔙", `settings:view:${entity}`)]);
  return buildRowsKeyboard(rows);
}

function buildSettingsPromptKeyboard(entity) {
  return buildRowsKeyboard([[Markup.button.callback("🔙", `settings:edit:${entity}`)]]);
}

function getUserRoleDisplay(user) {
  if (user.company === "RS") {
    return `RS пользователь${user.receives_meals ? " 🍽" : ""}`;
  }

  return user.role === USER_ROLES.OWNER ? "GR админ" : "GR пользователь";
}

function getUserCompanyLabel(company) {
  return company === "RS" ? "Railship" : "Green Rocket";
}

async function showSettingDetails(ctx, entity, editMode = false) {
  const details = entity === "performer" ? await getPerformerDetails() : await getCustomerDetails();
  const title = getSettingsEntityTitle(entity);
  const subtitle = editMode ? "Выберите реквизит для редактирования" : "Актуальные реквизиты";
  const keyboard = editMode
    ? buildSettingsFieldKeyboard(entity)
    : buildRowsKeyboard([
      [Markup.button.callback("Редактировать", `settings:edit:${entity}`)],
      [Markup.button.callback("🔙", "settings:root")]
    ]);

  await renderScreen(
    ctx,
    buildHtmlScreen(title, subtitle, buildSettingsDetailsLines(details)),
    keyboard
  );
}

async function showDocumentDetail(ctx, documentId) {
  const document = await getDocumentById(documentId);
  if (!document) {
    await renderScreen(ctx, buildHtmlScreen("Документ", "Запись не найдена"), backHomeKeyboard());
    return;
  }

  const rows = [[Markup.button.callback("Открыть исходный", `doc:send:generated:${document.id}`)]];
  if (document.signed_file_path) {
    rows.push([Markup.button.callback("Открыть подписанный", `doc:send:signed:${document.id}`)]);
  }
  if (getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    rows.push([
      Markup.button.callback(
        document.signed_file_path ? "Изменить подписанный" : "Загрузить подписанный",
        `doc:uploadsigned:${document.id}`
      )
    ]);
    rows.push([Markup.button.callback("Пометить отправленным", `doc:sent:${document.id}`)]);
  }
  rows.push([Markup.button.callback("🔙", "nav:documents")]);

  await renderScreen(
    ctx,
    buildHtmlScreen(`Документ #${document.id}`, "Карточка документа", [
      lineHtml("Тип", document.doc_type === DOCUMENT_TYPES.ACT ? "акт" : "сверка"),
      lineHtml("Дата", formatDateRu(document.document_date)),
      lineHtml("Номер", document.document_number || "-"),
      lineHtml("Период", `${formatDateRu(document.period_start)} - ${formatDateRu(document.period_end)}`),
      lineHtml("Статус", document.status),
      `<b>Сумма:</b> ${moneyHtml(document.total_amount)}`,
      lineHtml("Подписанный файл", document.signed_file_path ? "загружен" : "нет")
    ]),
    buildRowsKeyboard(rows)
  );
}

async function sendDocumentFile(ctx, documentId, signed = false, options = {}) {
  const document = await getDocumentById(documentId);
  if (!document) {
    await renderScreen(ctx, buildHtmlScreen("Документ", "Файл не найден"), backHomeKeyboard());
    return;
  }

  const filePath = signed ? document.signed_file_path : document.generated_file_path;
  if (!filePath) {
    await renderScreen(ctx, buildHtmlScreen("Документ", "Файл пока не загружен"), backHomeKeyboard());
    return;
  }

  const fileName = buildDocumentDownloadName(document, signed, options);
  await ctx.replyWithDocument(Input.fromLocalFile(filePath, fileName));

  if (!signed && getDisplayedRole(ctx) === USER_ROLES.OWNER) {
    await markDocumentSent(documentId);
  }
}

async function sendMonthUploadedDocumentFile(ctx, docKind, year, month) {
  const document = await getMonthUploadedDocument(docKind, year, month);
  if (!document?.signed_file_path) {
    await renderScreen(ctx, buildHtmlScreen("Документ", "Файл пока не загружен"), backHomeKeyboard());
    return;
  }

  const fileName = buildDocumentDownloadName(
    {
      ...document,
      doc_type: docKind,
      period_end: getMonthRange(month, year).endDate
    },
    true,
    { month, year }
  );
  await ctx.replyWithDocument(Input.fromLocalFile(document.signed_file_path, fileName));
}

async function promptSettingsFieldEdit(ctx, entity, fieldKey) {
  const details = entity === "performer" ? await getPerformerDetails() : await getCustomerDetails();
  const field = SETTINGS_FIELDS.find((item) => item.key === fieldKey);
  if (!field) {
    await sendSettingsSection(ctx);
    return;
  }

  setFlow(ctx, "settings:field_edit", "text", { entity, fieldKey });

  await renderScreen(
    ctx,
    buildHtmlScreen(getSettingsEntityTitle(entity), `Введите новое значение для поля «${field.label}»`, [
      lineHtml("Поле", field.label),
      lineHtml("Текущее значение", details[fieldKey] || "-")
    ]),
    buildSettingsPromptKeyboard(entity)
  );
}

async function handleSettingsFieldEdit(ctx, text) {
  const flow = currentFlow(ctx);
  const { entity, fieldKey } = flow.data;
  const currentDetails = entity === "performer" ? await getPerformerDetails() : await getCustomerDetails();
  const nextValue = text.trim();
  const updatedDetails = {
    ...currentDetails,
    [fieldKey]: nextValue === "-" ? "" : nextValue
  };

  if (entity === "performer") {
    await updatePerformerDetails(updatedDetails);
  } else {
    await updateCustomerDetails(updatedDetails);
  }

  clearFlow(ctx);
  await showSettingDetails(ctx, entity, true);
}

async function startUserRoleChoice(ctx) {
  setFlow(ctx, "user:add", "telegram_id", {});
  await renderScreen(ctx, buildHtmlScreen("Новый пользователь", "Введите Telegram ID пользователя"));
}

async function createUserFromFlow(ctx, flow) {
  let employeeId = flow.data.employeeId || null;

  if (flow.data.company === "RS" && flow.data.receivesMeals) {
    const mealFullName = String(flow.data.mealFullName || "").trim();
    if (employeeId) {
      const currentEmployee = await getEmployeeById(employeeId);
      if (currentEmployee) {
        const updatedEmployee = await updateEmployee(employeeId, {
          fullName: mealFullName,
          note: currentEmployee.note,
          isActive: true
        });
        employeeId = updatedEmployee.id;
      } else {
        const createdEmployee = await createEmployee({ fullName: mealFullName, note: null });
        employeeId = createdEmployee.id;
      }
    } else {
      const createdEmployee = await createEmployee({ fullName: mealFullName, note: null });
      employeeId = createdEmployee.id;
    }
  }

  const user = await upsertUser({
    telegramId: flow.data.telegramId,
    fullName: flow.data.fullName,
    username: flow.data.username,
    role: flow.data.role,
    company: flow.data.company,
    receivesMeals: flow.data.receivesMeals,
    employeeId
  });

  clearFlow(ctx);
  await answerCb(ctx, "Пользователь сохранён");
  await showUserDetail(ctx, user.id);
}

function buildMealAmountKeyboard() {
  return buildRowsKeyboard([
    [Markup.button.callback("Выбрать другую дату", "meal:add:change_date")],
    [Markup.button.callback("🔙", "meal:add")]
  ]);
}

function buildMealDateKeyboard() {
  return buildRowsKeyboard([
    [Markup.button.callback("Сегодня", "flow:date:today"), Markup.button.callback("Вчера", "flow:date:yesterday")],
    [Markup.button.callback("Ввести дату", "flow:date:custom")],
    [Markup.button.callback("🔙", "meal:add:amount_screen")]
  ]);
}

function buildAdvanceDateKeyboard(backData = "doc:create_menu") {
  return buildRowsKeyboard([
    [Markup.button.callback("Сегодня", "flow:date:today"), Markup.button.callback("Вчера", "flow:date:yesterday")],
    [Markup.button.callback("Ввести дату", "flow:date:custom")],
    [Markup.button.callback("🔙", backData)]
  ]);
}

function buildAdvanceAmountKeyboard(backData = "doc:advance:add") {
  return buildRowsKeyboard([[Markup.button.callback("🔙", backData)]]);
}

function buildAdvanceDocumentKeyboard() {
  return buildRowsKeyboard([[Markup.button.callback("🔙", "doc:advance:amount_screen")]]);
}

async function promptMealAmount(ctx, employeeName, mealDate, employeeId, alertLines = []) {
  const spent = await getEmployeeSpentForDate(employeeId, mealDate);
  const remaining = Math.max(0, Number((DAILY_LIMIT - spent).toFixed(2)));
  const lines = [
    lineHtml("Сотрудник", employeeName),
    lineHtml("Дата", formatDateRu(mealDate)),
    `<b>Уже за день:</b> ${moneyHtml(spent)}`,
    `<b>Осталось лимита:</b> ${moneyHtml(remaining)}`
  ];

  if (alertLines.length) {
    lines.push("", ...alertLines);
  }

  lines.push("", alertLines.length ? "<b>ВВЕДИТЕ ДРУГУЮ СУММУ:</b>" : "<b>ВВЕДИТЕ СУММУ:</b>");

  await renderScreen(
    ctx,
    buildHtmlScreen("Добавить питание", null, lines),
    buildMealAmountKeyboard()
  );
}

async function saveMealFromFlow(ctx, flow, amount) {
  if (!amount || amount <= 0) {
    await promptMealAmount(
      ctx,
      flow.data.employeeName,
      flow.data.mealDate,
      flow.data.employeeId,
      ["<b>❗ Введите корректную сумму числом больше нуля</b>"]
    );
    return;
  }

  const spent = await getEmployeeSpentForDate(flow.data.employeeId, flow.data.mealDate);
  const nextTotal = Number((spent + amount).toFixed(2));
  if (nextTotal > DAILY_LIMIT) {
    await promptMealAmount(
      ctx,
      flow.data.employeeName,
      flow.data.mealDate,
      flow.data.employeeId,
      [
        "<b>❗ Лимит превышен</b>",
        `Нельзя добавить питание сверх ${formatAmount(DAILY_LIMIT)} в день`
      ]
    );
    return;
  }

  await createMealEntry({
    mealDate: flow.data.mealDate,
    employeeId: flow.data.employeeId,
    amount,
    comment: null,
    createdByUserId: ctx.state.user.id
  });

  clearFlow(ctx);
  await sendMainMenu(ctx, "Питание добавлено.");
}

async function startMealAddForEmployee(ctx, employee) {
  setFlow(ctx, "meal:add", "amount", {
    employeeId: employee.id,
    employeeName: employee.full_name,
    mealDate: todayIso()
  });
  await promptMealAmount(ctx, employee.full_name, todayIso(), employee.id);
}

async function handleTextFlow(ctx, text) {
  const flow = currentFlow(ctx);
  if (!flow) {
    await sendMainMenu(ctx, "Используйте inline-кнопки меню.");
    return;
  }

  if (flow.name === "employee:add") {
    if (flow.step === "full_name") {
      const fullName = text.trim();
      if (!fullName) {
        await renderScreen(ctx, buildHtmlScreen("Новый сотрудник", "Введите ФИО сотрудника"));
        return;
      }

      const employee = await createEmployee({
        fullName,
        note: null
      });
      clearFlow(ctx);
      await sendMainMenu(ctx, `Сотрудник «${employee.full_name}» добавлен.`);
      return;
    }
  }

  if (flow.name === "employee:edit_name" && flow.step === "full_name") {
    const fullName = text.trim();
    if (!fullName) {
      await renderScreen(
        ctx,
        buildHtmlScreen("Изменить имя сотрудника", "Введите новое ФИО"),
        buildRowsKeyboard([[Markup.button.callback("🔙", `employee:view:${flow.data.employeeId}`)]])
      );
      return;
    }

    const current = await getEmployeeById(flow.data.employeeId);
    if (!current) {
      clearFlow(ctx);
      await renderScreen(ctx, buildHtmlScreen("Сотрудник", "Запись не найдена"), backHomeKeyboard());
      return;
    }

    const updated = await updateEmployee(flow.data.employeeId, {
      fullName,
      note: current.note,
      isActive: current.is_active
    });
    clearFlow(ctx);
    await answerCb(ctx, "Имя обновлено");
    await showEmployeeDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "user:add") {
    if (flow.step === "telegram_id") {
      const telegramId = Number(text.trim());
      if (!Number.isInteger(telegramId) || telegramId <= 0) {
        await renderScreen(ctx, buildHtmlScreen("Новый пользователь", "Введите корректный числовой Telegram ID"));
        return;
      }
      flow.data.telegramId = telegramId;
      flow.step = "full_name";
      await renderScreen(ctx, buildHtmlScreen("Новый пользователь", "Введите имя пользователя"));
      return;
    }

    if (flow.step === "full_name") {
      flow.data.fullName = text.trim();
      flow.step = "username";
      await renderScreen(ctx, buildHtmlScreen("Новый пользователь", "Введите username без @ или '-' чтобы пропустить"));
      return;
    }

    if (flow.step === "username") {
      flow.data.username = text.trim() === "-" ? null : text.trim().replace(/^@/, "");
      flow.step = "company";
      await renderScreen(
        ctx,
        buildHtmlScreen("Новый пользователь", "Выберите компанию"),
        buildRowsKeyboard([
          [Markup.button.callback("Green Rocket", "user:add:company:GR"), Markup.button.callback("Railship", "user:add:company:RS")],
          [Markup.button.callback("🔙", "user:list:page:0")]
        ])
      );
      return;
    }

    if (flow.step === "meal_full_name") {
      const mealFullName = text.trim();
      if (!mealFullName) {
        await renderScreen(
          ctx,
          buildHtmlScreen("ФИО для питания", "Введите ФИО сотрудника для списка питания"),
          buildRowsKeyboard([[Markup.button.callback("🔙", "user:add:rs_meals_screen")]])
        );
        return;
      }

      flow.data.mealFullName = mealFullName;
      await createUserFromFlow(ctx, flow);
      return;
    }
  }

  if (flow.name === "user:meal_name" && flow.step === "text") {
    const mealFullName = text.trim();
    if (!mealFullName) {
      await renderScreen(
        ctx,
        buildHtmlScreen("ФИО для питания", "Введите ФИО сотрудника для списка питания"),
        buildRowsKeyboard([[Markup.button.callback("🔙", `user:view:${flow.data.userId}`)]])
      );
      return;
    }

    const user = await getUserById(flow.data.userId);
    if (!user) {
      clearFlow(ctx);
      await renderScreen(ctx, buildHtmlScreen("Пользователь", "Запись не найдена"), backHomeKeyboard());
      return;
    }

    let employeeId = user.employee_id;
    if (employeeId) {
      const employee = await getEmployeeById(employeeId);
      if (employee) {
        await updateEmployee(employeeId, {
          fullName: mealFullName,
          note: employee.note,
          isActive: true
        });
      } else {
        const createdEmployee = await createEmployee({ fullName: mealFullName, note: null });
        employeeId = createdEmployee.id;
      }
    } else {
      const createdEmployee = await createEmployee({ fullName: mealFullName, note: null });
      employeeId = createdEmployee.id;
    }

    await updateUserRsSettings(user.id, {
      receivesMeals: true,
      employeeId
    });
    clearFlow(ctx);
    await answerCb(ctx, "ФИО обновлено");
    await showUserDetail(ctx, user.id);
    return;
  }

  if (flow.name === "meal:add") {
    if (flow.step === "date_custom") {
      const mealDate = parseDateInput(text);
      if (!mealDate) {
        await renderScreen(
          ctx,
          buildHtmlScreen("Дата питания", "Введите дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"),
          buildMealDateKeyboard()
        );
        return;
      }
      flow.data.mealDate = mealDate;
      flow.step = "amount";
      await promptMealAmount(ctx, flow.data.employeeName, flow.data.mealDate, flow.data.employeeId);
      return;
    }

    if (flow.step === "amount") {
      const amount = parseAmount(text);
      await saveMealFromFlow(ctx, flow, amount);
      return;
    }
  }

  if (flow.name === "meal:edit:amount") {
    const amount = parseAmount(text);
    if (!amount) {
      await renderScreen(ctx, buildHtmlScreen("Изменить сумму", "Введите положительную сумму"));
      return;
    }
    const updated = await updateMealEntry(flow.data.mealId || flow.data.id, {
      mealDate: flow.data.mealDate || flow.data.meal_date,
      employeeId: flow.data.employeeId || flow.data.employee_id,
      amount,
      comment: flow.data.comment,
      updatedByUserId: ctx.state.user.id
    });
    clearFlow(ctx);
    await showMealDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "meal:edit:comment") {
    const updated = await updateMealEntry(flow.data.mealId || flow.data.id, {
      mealDate: flow.data.mealDate || flow.data.meal_date,
      employeeId: flow.data.employeeId || flow.data.employee_id,
      amount: flow.data.amount,
      comment: text.trim() === "-" ? null : text.trim(),
      updatedByUserId: ctx.state.user.id
    });
    clearFlow(ctx);
    await showMealDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "meal:edit:date" && flow.step === "date_custom") {
    const mealDate = parseDateInput(text);
    if (!mealDate) {
      await renderScreen(ctx, buildHtmlScreen("Изменить дату", "Введите дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"));
      return;
    }
    const updated = await updateMealEntry(flow.data.mealId || flow.data.id, {
      mealDate,
      employeeId: flow.data.employeeId || flow.data.employee_id,
      amount: flow.data.amount,
      comment: flow.data.comment,
      updatedByUserId: ctx.state.user.id
    });
    clearFlow(ctx);
    await showMealDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "advance:add") {
    if (flow.step === "date_custom") {
      const paymentDate = parseDateInput(text);
      if (!paymentDate) {
        await renderScreen(ctx, buildHtmlScreen("Дата аванса", "Введите дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"), buildAdvanceDateKeyboard(flow.data.returnTo || "doc:create_menu"));
        return;
      }
      flow.data.paymentDate = paymentDate;
      flow.step = "amount";
      await renderScreen(ctx, buildHtmlScreen("Добавить аванс", "Введите сумму аванса"), buildAdvanceAmountKeyboard(flow.data.returnTo === "nav:advances" ? "advance:add" : "doc:advance:add"));
      return;
    }

    if (flow.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await renderScreen(ctx, buildHtmlScreen("Добавить аванс", "Введите положительную сумму"), buildAdvanceAmountKeyboard(flow.data.returnTo === "nav:advances" ? "advance:add" : "doc:advance:add"));
        return;
      }
      flow.data.amount = amount;
      flow.step = "document";
      await renderScreen(
        ctx,
        buildHtmlScreen("Загрузить документ аванса", "Отправьте документ аванса в этот чат"),
        buildAdvanceDocumentKeyboard()
      );
      return;
    }
  }

  if (flow.name === "advance:edit:amount") {
    const amount = parseAmount(text);
    if (!amount) {
      await renderScreen(ctx, buildHtmlScreen("Изменить аванс", "Введите положительную сумму"));
      return;
    }
    const updated = await updateAdvance(flow.data.advanceId || flow.data.id, {
      paymentDate: flow.data.paymentDate || flow.data.payment_date,
      amount,
      comment: flow.data.comment,
      updatedByUserId: ctx.state.user.id
    });
    clearFlow(ctx);
    await showAdvanceDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "advance:edit:comment") {
    const updated = await updateAdvance(flow.data.advanceId || flow.data.id, {
      paymentDate: flow.data.paymentDate || flow.data.payment_date,
      amount: flow.data.amount,
      comment: text.trim() === "-" ? null : text.trim(),
      updatedByUserId: ctx.state.user.id
    });
    clearFlow(ctx);
    await showAdvanceDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "advance:edit:date" && flow.step === "date_custom") {
    const paymentDate = parseDateInput(text);
    if (!paymentDate) {
      await renderScreen(ctx, buildHtmlScreen("Изменить дату аванса", "Введите дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"));
      return;
    }
    const updated = await updateAdvance(flow.data.advanceId || flow.data.id, {
      paymentDate,
      amount: flow.data.amount,
      comment: flow.data.comment,
      updatedByUserId: ctx.state.user.id
    });
    clearFlow(ctx);
    await showAdvanceDetail(ctx, updated.id);
    return;
  }

  if (flow.name === "doc:act") {
    await showDocumentPeriodScreen(ctx, "act", flow.data || await getDefaultDocumentFlowData("act"));
    return;
  }

  if (flow.name === "doc:reconciliation") {
    await showDocumentPeriodScreen(ctx, "reconciliation", flow.data || await getDefaultDocumentFlowData("reconciliation"));
    return;
  }

  if (flow.name === "period:custom:meals") {
    const period = parsePeriodInput(text);
    if (!period) {
      await renderScreen(ctx, buildHtmlScreen("Период питания", "Введите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"));
      return;
    }
    ctx.session.customPeriods.meals = period;
    clearFlow(ctx);
    await showMealList(ctx, "custom", 0);
    return;
  }

  if (flow.name === "period:custom:advances") {
    const period = parsePeriodInput(text);
    if (!period) {
      await renderScreen(ctx, buildHtmlScreen("Период авансов", "Введите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"));
      return;
    }
    ctx.session.customPeriods.advances = period;
    clearFlow(ctx);
    await showAdvanceList(ctx, "custom", 0);
    return;
  }

  if (flow.name === "settings:field_edit") {
    await handleSettingsFieldEdit(ctx, text);
    return;
  }

  await sendMainMenu(ctx);
}

async function handleDocumentUpload(ctx) {
  const flow = currentFlow(ctx);
  if (flow?.name === "advance:add" && flow.step === "document") {
    if (!flow.data.paymentDate || !flow.data.amount) {
      clearFlow(ctx);
      await renderScreen(ctx, buildHtmlScreen("Аванс", "Не хватает даты или суммы аванса"), backHomeKeyboard());
      return;
    }

    await ensureDir(config.signedDocumentsDir);

    const advance = flow.data.advanceId
      ? await updateAdvance(flow.data.advanceId, {
        paymentDate: flow.data.paymentDate,
        amount: flow.data.amount,
        comment: null,
        updatedByUserId: ctx.state.user.id
      })
      : await createAdvance({
        paymentDate: flow.data.paymentDate,
        amount: flow.data.amount,
        comment: null,
        createdByUserId: ctx.state.user.id
      });

    const fileName = ctx.message.document.file_name || `advance_${advance.id}.bin`;
    const extension = path.extname(fileName) || ".bin";
    const safePath = buildFilePath(config.signedDocumentsDir, `advance_${advance.id}_${Date.now()}${extension}`);
    const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);

    await downloadFile(String(link), safePath);
    await attachAdvanceDocument(advance.id, {
      documentFilePath: safePath,
      documentOriginalName: fileName,
      uploadedByUserId: ctx.state.user.id
    });

    clearFlow(ctx);

    const [year, month] = String(advance.payment_date).split("-").slice(0, 2).map(Number);
    if (year && month) {
      await showClientMonthDetails(ctx, month, year);
      return;
    }

    await showAdvanceDetail(ctx, advance.id);
    return;
  }

  if (!flow || flow.name !== "doc:upload_signed") {
    await renderScreen(ctx, buildHtmlScreen("Загрузка документа", "Сейчас бот не ожидает загрузку подписанного файла"));
    return;
  }

  if (flow.data.uploadMode === "month") {
    const year = Number(flow.data.year);
    const month = Number(flow.data.month);
    const docKind = flow.data.docKind;

    if (!year || !month || ![DOCUMENT_TYPES.ACT, DOCUMENT_TYPES.RECONCILIATION].includes(docKind)) {
      clearFlow(ctx);
      await renderScreen(ctx, buildHtmlScreen("Загрузка документа", "Не удалось определить месяц документа"));
      return;
    }

    await ensureDir(config.signedDocumentsDir);

    const fileName = ctx.message.document.file_name || `${docKind}_${year}_${month}.bin`;
    const extension = path.extname(fileName) || ".bin";
    const safePath = buildFilePath(config.signedDocumentsDir, `${docKind}_${year}_${String(month).padStart(2, "0")}_${Date.now()}${extension}`);
    const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);

    await downloadFile(String(link), safePath);
    await upsertMonthUploadedDocument({
      docKind,
      year,
      month,
      signedFilePath: safePath,
      originalFileName: fileName,
      userId: ctx.state.user.id
    });

    clearFlow(ctx);
    await showClientMonthDetails(ctx, month, year);
    return;
  }

  const doc = await getDocumentById(flow.data.documentId);
  if (!doc) {
    clearFlow(ctx);
    await renderScreen(ctx, buildHtmlScreen("Загрузка документа", "Документ не найден"));
    return;
  }

  await ensureDir(config.signedDocumentsDir);

  const fileName = ctx.message.document.file_name || `signed_${doc.id}.bin`;
  const extension = path.extname(fileName) || ".bin";
  const safePath = buildFilePath(config.signedDocumentsDir, `signed_${doc.id}_${Date.now()}${extension}`);
  const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);

  await downloadFile(String(link), safePath);
  await attachSignedDocument(doc.id, safePath, ctx.state.user.id);

  clearFlow(ctx);
  const returnYear = Number(flow.data.year);
  const returnMonth = Number(flow.data.month);

  if (flow.data.returnTo === "client_month" && returnYear && returnMonth) {
    await showClientMonthDetails(ctx, returnMonth, returnYear);
    return;
  }

  const fallbackMonthYear = getDocumentDownloadMonthYear(doc);
  if (fallbackMonthYear) {
    await showClientMonthDetails(ctx, fallbackMonthYear.month, fallbackMonthYear.year);
    return;
  }

  await showDocumentDetail(ctx, doc.id);
}

function withError(handler) {
  return async (ctx, ...args) => {
    try {
      await handler(ctx, ...args);
    } catch (error) {
      console.error("Handler error:", error);
      clearFlow(ctx);
      await sendMainMenu(ctx, `Ошибка: ${error.message}`);
    }
  };
}

function registerHandlers(bot) {
  bot.use((ctx, next) => {
    ensureSession(ctx);
    return next();
  });

  bot.start(
    withError(async (ctx) => {
      await sendMainMenu(ctx);
    })
  );

  bot.command(
    "menu",
    withError(async (ctx) => {
      await sendMainMenu(ctx);
    })
  );

  bot.command(
    "whoami",
    withError(async (ctx) => {
      await renderScreen(
        ctx,
        buildHtmlScreen("Кто я", "Текущие параметры доступа", [
          lineHtml("Telegram ID", ctx.from.id),
          lineHtml("Роль в системе", ctx.state.user.role),
          lineHtml("Отображаемая роль", getDisplayedRole(ctx))
        ]),
        backHomeKeyboard()
      );
    })
  );

  bot.command(
    "role",
    withError(async (ctx) => {
      await sendRoleScreen(ctx);
    })
  );

  bot.action("noop", async (ctx) => {
    await answerCb(ctx);
  });

  bot.action(/client:dashboard:header:(date|advance|meal)/, withError(async (ctx) => {
    const labels = {
      date: "Это заголовок колонки: дата или период.",
      advance: "Это заголовок колонки: авансы.",
      meal: "Это заголовок колонки: питание."
    };
    await answerCb(ctx, labels[ctx.match[1]], { show_alert: true });
  }));

  bot.action("client:dashboard:legacy_period", withError(async (ctx) => {
    await answerCb(ctx, "Это исторический диапазон Ноя.25 - фев.26. Он показан только для отчёта и не открывается.", { show_alert: true });
  }));

  bot.action("nav:home", withError(async (ctx) => {
    await answerCb(ctx);
    await sendMainMenu(ctx);
  }));

  bot.action("client:home", withError(async (ctx) => {
    await answerCb(ctx);
    await showClientDashboard(ctx);
  }));

  bot.action("client:home:refresh", withError(async (ctx) => {
    await answerCb(ctx);
    await showClientDashboard(ctx);
  }));

  bot.action("doc:create_menu", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await showDocumentCreateMenu(ctx);
  }));

  bot.action(/client:year:shift:(-?1)/, withError(async (ctx) => {
    const delta = Number(ctx.match[1]);
    const nextYear = getAdjacentYear(getSelectedReportMonth(ctx).year, delta);
    const hasData = await clientYearHasData(nextYear);

    if (!hasData && getDisplayedRole(ctx) !== USER_ROLES.OWNER) {
      await answerCb(ctx, "данных нет");
      return;
    }

    await answerCb(ctx);
    const currentMonth = getSelectedReportMonth(ctx).month;
    setSelectedReportMonth(ctx, currentMonth, nextYear);
    await showClientDashboard(ctx);
  }));

  bot.action(/client:advance:info:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    const year = Number(ctx.match[1]);
    const month = Number(ctx.match[2]);
    const yearTotals = await getYearlyMonthlyTotals(year);
    const current = yearTotals.months.find((item) => item.month === month);
    const amountLabel = formatClientAmountLabel(current?.advanceTotal || 0, { zeroAsDash: true });
    await answerCb(ctx, `Авансы за ${getMonthShortButtonLabel(month)}: ${amountLabel}`);
  }));

  bot.action(/client:month:open:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    const year = Number(ctx.match[1]);
    const month = Number(ctx.match[2]);
    const hasData = await clientMonthHasData(month, year);

    if (!hasData && getDisplayedRole(ctx) !== USER_ROLES.OWNER) {
      await answerCb(ctx, "данных нет");
      return;
    }

    await answerCb(ctx);
    await showClientMonthDetails(ctx, month, year);
  }));

  bot.action(/client:month:refresh:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    await showClientMonthDetails(ctx, Number(ctx.match[2]), Number(ctx.match[1]));
  }));

  bot.action("client:journal:current", withError(async (ctx) => {
    await answerCb(ctx);
    const { month, year } = getSelectedReportMonth(ctx);
    await showClientMonthJournal(ctx, month, year, 0);
  }));

  bot.action(/client:journal:open:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    await showClientMonthJournal(ctx, Number(ctx.match[2]), Number(ctx.match[1]), 0);
  }));

  bot.action(/client:journal:page:(\d{4}):(\d{1,2}):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showClientMonthJournal(ctx, Number(ctx.match[2]), Number(ctx.match[1]), Number(ctx.match[3]));
  }));

  bot.action(/client:journal:refresh:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    await showClientMonthJournal(ctx, Number(ctx.match[2]), Number(ctx.match[1]), 0);
  }));

  bot.action(/client:month:(hub:)?shift:(-?1)/, withError(async (ctx) => {
    const delta = Number(ctx.match[2]);
    const { month, year } = getSelectedReportMonth(ctx);
    const next = getAdjacentMonth(month, year, delta);
    const hasData = await clientMonthHasData(next.month, next.year);

    if (!hasData && getDisplayedRole(ctx) !== USER_ROLES.OWNER) {
      await answerCb(ctx, "данных нет");
      return;
    }

    await answerCb(ctx);
    await showClientMonthDetails(ctx, next.month, next.year);
  }));

  bot.action(/client:month:page:(\d{4}):(\d{1,2}):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showClientMonthJournal(ctx, Number(ctx.match[2]), Number(ctx.match[1]), Number(ctx.match[3]));
  }));

  bot.action(/client:month:journal:shift:(-?1)/, withError(async (ctx) => {
    const delta = Number(ctx.match[1]);
    const { month, year } = getSelectedReportMonth(ctx);
    const next = getAdjacentMonth(month, year, delta);
    const hasData = await clientMonthHasData(next.month, next.year);

    if (!hasData && getDisplayedRole(ctx) !== USER_ROLES.OWNER) {
      await answerCb(ctx, "данных нет");
      return;
    }

    await answerCb(ctx);
    await showClientMonthJournal(ctx, next.month, next.year, 0);
  }));

  bot.action(/client:meal:view:(\d+):(\d{4}):(\d{1,2}):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const mealId = Number(ctx.match[1]);
    const year = Number(ctx.match[2]);
    const month = Number(ctx.match[3]);
    const page = Number(ctx.match[4]);
    setSelectedReportMonth(ctx, month, year);
    await showMealDetail(ctx, mealId, { backData: `client:journal:page:${year}:${month}:${page}` });
  }));

  bot.action(/client:doc:(act|reconciliation):(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    const type = ctx.match[1];
    const year = Number(ctx.match[2]);
    const month = Number(ctx.match[3]);
    const documents = await getMonthDocuments(month, year);
    const document = type === "act" ? documents.act : documents.reconciliation;

    if (!document) {
      await answerCb(ctx, "документ не загружен");
      return;
    }

    await answerCb(ctx);
    if (document.is_month_upload) {
      await sendMonthUploadedDocumentFile(ctx, type, year, month);
      return;
    }

    await sendDocumentFile(ctx, document.id, Boolean(document.signed_file_path), { month, year });
  }));

  bot.action(/nav:(meals|advances|reports|documents|employees|users|settings|role)/, withError(async (ctx) => {
    await answerCb(ctx);
    const section = ctx.match[1];

    if (section === "meals") {
      await sendMealsSection(ctx);
      return;
    }

    if (section === "advances") {
      if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
        await answerCb(ctx, "Раздел доступен только owner");
        return;
      }
      await sendAdvancesSection(ctx);
      return;
    }

    if (section === "reports") {
      await showClientDashboard(ctx);
      return;
    }

    if (section === "documents") {
      await sendDocumentsSection(ctx);
      return;
    }

    if (section === "employees") {
      await showEmployeeList(ctx, 0);
      return;
    }

    if (section === "users") {
      if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
        await answerCb(ctx, "Раздел доступен только owner");
        return;
      }
      await showUserList(ctx, 0);
      return;
    }

    if (section === "settings") {
      if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
        await answerCb(ctx, "Раздел доступен только owner");
        return;
      }
      await sendSettingsSection(ctx);
      return;
    }

    if (!isActualOwner(ctx)) {
      await answerCb(ctx, "Переключение доступно только owner");
      return;
    }

    await sendRoleScreen(ctx);
  }));

  bot.action(/role:set:(owner|barista|client_viewer|reset)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!isActualOwner(ctx)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const value = ctx.match[1];
    ctx.session.previewRole = value === "reset" ? null : value;
    await sendMainMenu(ctx, "Роль переключена.");
  }));

  bot.action("employee:add", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Добавлять сотрудников может только owner");
      return;
    }

    setFlow(ctx, "employee:add", "full_name", {});
    await renderScreen(ctx, buildHtmlScreen("Новый сотрудник", "Введите ФИО сотрудника"));
  }));

  bot.action(/employee:list:page:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showEmployeeList(ctx, Number(ctx.match[1]));
  }));

  bot.action(/employee:view:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showEmployeeDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action(/employee:toggle:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    const employee = await toggleEmployeeActive(Number(ctx.match[1]));
    await answerCb(ctx, "Статус обновлён");
    await showEmployeeDetail(ctx, employee.id);
  }));

  bot.action(/employee:edit:name:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const employee = await getEmployeeById(Number(ctx.match[1]));
    if (!employee) {
      await renderScreen(ctx, buildHtmlScreen("Сотрудник", "Запись не найдена"), backHomeKeyboard());
      return;
    }

    setFlow(ctx, "employee:edit_name", "full_name", { employeeId: employee.id });
    await renderScreen(
      ctx,
      buildHtmlScreen("Изменить имя сотрудника", "Введите новое ФИО", [
        lineHtml("Текущее имя", employee.full_name)
      ]),
      buildRowsKeyboard([[Markup.button.callback("🔙", `employee:view:${employee.id}`)]])
    );
  }));

  bot.action(/employee:delete:confirm:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const employee = await getEmployeeById(Number(ctx.match[1]));
    if (!employee) {
      await renderScreen(ctx, buildHtmlScreen("Сотрудник", "Запись не найдена"), backHomeKeyboard());
      return;
    }

    const mealsCount = await countEmployeeMeals(employee.id);
    if (mealsCount > 0) {
      await answerCb(ctx, "Удаление недоступно");
      await showEmployeeDetail(ctx, employee.id);
      return;
    }

    await renderScreen(
      ctx,
      buildHtmlScreen("Удалить сотрудника", "Подтвердите удаление", [
        lineHtml("Сотрудник", employee.full_name),
        lineHtml("Записей питания", mealsCount)
      ]),
      buildRowsKeyboard([
        [Markup.button.callback("Удалить", `employee:delete:${employee.id}`)],
        [Markup.button.callback("🔙", `employee:view:${employee.id}`)]
      ])
    );
  }));

  bot.action(/employee:delete:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const employeeId = Number(ctx.match[1]);
    const mealsCount = await countEmployeeMeals(employeeId);
    if (mealsCount > 0) {
      await answerCb(ctx, "Удаление недоступно");
      await showEmployeeDetail(ctx, employeeId);
      return;
    }

    const employee = await deleteEmployee(employeeId);
    if (!employee) {
      await renderScreen(ctx, buildHtmlScreen("Сотрудник", "Запись не найдена"), backHomeKeyboard());
      return;
    }

    await answerCb(ctx, "Сотрудник удалён");
    await showEmployeeList(ctx, 0);
  }));

  bot.action("user:add", withError(async (ctx) => {
    await answerCb(ctx);
    await startUserRoleChoice(ctx);
  }));

  bot.action("user:add:rs_meals_screen", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "user:add") {
      await answerCb(ctx, "Сначала заполните данные пользователя");
      return;
    }

    flow.step = "receives_meals";
    await renderScreen(
      ctx,
      buildHtmlScreen("Новый пользователь", "Питается ли сотрудник?"),
      buildRowsKeyboard([
        [Markup.button.callback("Да", "user:add:rs_meals:yes"), Markup.button.callback("Нет", "user:add:rs_meals:no")],
        [Markup.button.callback("🔙", "user:list:page:0")]
      ])
    );
  }));

  bot.action(/user:add:company:(GR|RS)/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "user:add" || flow.step !== "company") {
      await answerCb(ctx, "Сначала заполните данные пользователя");
      return;
    }

    flow.data.company = ctx.match[1];

    if (ctx.match[1] === "GR") {
      flow.step = "role";
      await renderScreen(
        ctx,
        buildHtmlScreen("Новый пользователь", "Выберите роль Green Rocket"),
        buildRowsKeyboard([
          [Markup.button.callback("GR админ", "user:add:role:owner"), Markup.button.callback("GR пользователь", "user:add:role:barista")],
          [Markup.button.callback("🔙", "user:list:page:0")]
        ])
      );
      return;
    }

    flow.data.role = USER_ROLES.CLIENT_VIEWER;
    flow.data.company = "RS";
    flow.data.receivesMeals = false;
    flow.step = "receives_meals";
    await renderScreen(
      ctx,
      buildHtmlScreen("Новый пользователь", "Питается ли сотрудник?"),
      buildRowsKeyboard([
        [Markup.button.callback("Да", "user:add:rs_meals:yes"), Markup.button.callback("Нет", "user:add:rs_meals:no")],
        [Markup.button.callback("🔙", "user:list:page:0")]
      ])
    );
  }));

  bot.action(/user:add:role:(owner|barista)/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "user:add" || flow.step !== "role") {
      await answerCb(ctx, "Сначала заполните данные пользователя");
      return;
    }

    flow.data.role = ctx.match[1];
    flow.data.receivesMeals = false;
    await createUserFromFlow(ctx, flow);
  }));

  bot.action(/user:add:rs_meals:(yes|no)/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "user:add") {
      await answerCb(ctx, "Сначала заполните данные пользователя");
      return;
    }

    flow.data.company = "RS";
    flow.data.role = USER_ROLES.CLIENT_VIEWER;
    flow.data.receivesMeals = ctx.match[1] === "yes";

    if (flow.data.receivesMeals) {
      flow.step = "meal_full_name";
      await renderScreen(
        ctx,
        buildHtmlScreen("ФИО для питания", "Введите ФИО сотрудника для списка питания"),
        buildRowsKeyboard([[Markup.button.callback("🔙", "user:add:rs_meals_screen")]])
      );
      return;
    }

    await createUserFromFlow(ctx, flow);
  }));

  bot.action(/user:list:page:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showUserList(ctx, Number(ctx.match[1]));
  }));

  bot.action(/user:view:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showUserDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action(/user:role:open:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const user = await getUserById(Number(ctx.match[1]));
    if (!user || user.company !== "GR") {
      await answerCb(ctx, "Изменение роли недоступно");
      return;
    }

    await renderScreen(
      ctx,
      buildHtmlScreen("Изменить роль", "Выберите роль пользователя", [
        lineHtml("Имя", user.full_name),
        lineHtml("Текущая роль", getUserRoleDisplay(user))
      ]),
      buildRowsKeyboard([
        [Markup.button.callback("GR админ", `user:role:${user.id}:owner`), Markup.button.callback("GR пользователь", `user:role:${user.id}:barista`)],
        [Markup.button.callback("🔙", `user:view:${user.id}`)]
      ])
    );
  }));

  bot.action(/user:role:(\d+):(owner|barista|client_viewer)/, withError(async (ctx) => {
    await answerCb(ctx);
    const current = await getUserById(Number(ctx.match[1]));
    if (!current || current.company !== "GR") {
      await answerCb(ctx, "Изменение роли недоступно");
      return;
    }

    const user = await updateUserRole(Number(ctx.match[1]), ctx.match[2]);
    await answerCb(ctx, "Роль обновлена");
    await showUserDetail(ctx, user.id);
  }));

  bot.action(/user:meals:toggle:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const user = await getUserById(Number(ctx.match[1]));
    if (!user || user.company !== "RS") {
      await answerCb(ctx, "Недоступно");
      return;
    }

    if (user.receives_meals) {
      if (user.employee_id) {
        const employee = await getEmployeeById(user.employee_id);
        if (employee) {
          await updateEmployee(employee.id, {
            fullName: employee.full_name,
            note: employee.note,
            isActive: false
          });
        }
      }

      const updated = await updateUserRsSettings(user.id, {
        receivesMeals: false,
        employeeId: user.employee_id
      });
      await answerCb(ctx, "Питание выключено");
      await showUserDetail(ctx, updated.id);
      return;
    }

    if (user.employee_id) {
      const employee = await getEmployeeById(user.employee_id);
      if (employee) {
        await updateEmployee(employee.id, {
          fullName: employee.full_name,
          note: employee.note,
          isActive: true
        });
        const updated = await updateUserRsSettings(user.id, {
          receivesMeals: true,
          employeeId: employee.id
        });
        await answerCb(ctx, "Питание включено");
        await showUserDetail(ctx, updated.id);
        return;
      }
    }

    setFlow(ctx, "user:meal_name", "text", { userId: user.id });
    await renderScreen(
      ctx,
      buildHtmlScreen("ФИО для питания", "Введите ФИО сотрудника для списка питания"),
      buildRowsKeyboard([[Markup.button.callback("🔙", `user:view:${user.id}`)]])
    );
  }));

  bot.action(/user:meal_name:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const user = await getUserById(Number(ctx.match[1]));
    if (!user || user.company !== "RS") {
      await answerCb(ctx, "Недоступно");
      return;
    }

    setFlow(ctx, "user:meal_name", "text", { userId: user.id });
    await renderScreen(
      ctx,
      buildHtmlScreen("ФИО для питания", "Введите ФИО сотрудника для списка питания", [
        lineHtml("Текущее ФИО", user.employee_id ? (await getEmployeeById(user.employee_id))?.full_name || "-" : "-")
      ]),
      buildRowsKeyboard([[Markup.button.callback("🔙", `user:view:${user.id}`)]])
    );
  }));

  bot.action(/user:toggle:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const user = await toggleUserActive(Number(ctx.match[1]));
    await answerCb(ctx, "Статус обновлён");
    await showUserDetail(ctx, user.id);
  }));

  bot.action("settings:root", withError(async (ctx) => {
    await answerCb(ctx);
    clearFlow(ctx);
    await sendSettingsSection(ctx);
  }));

  bot.action("settings:requisites", withError(async (ctx) => {
    await answerCb(ctx);
    clearFlow(ctx);
    await renderScreen(
      ctx,
      buildHtmlScreen("Реквизиты сторон", "Используются при формировании документов"),
      buildRowsKeyboard([
        [Markup.button.callback("Исполнитель", "settings:view:performer"), Markup.button.callback("Заказчик", "settings:view:customer")],
        [Markup.button.callback("🔙", "settings:root")]
      ])
    );
  }));

  bot.action(/settings:view:(performer|customer)/, withError(async (ctx) => {
    await answerCb(ctx);
    clearFlow(ctx);
    await showSettingDetails(ctx, ctx.match[1]);
  }));

  bot.action(/settings:edit:(performer|customer)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    clearFlow(ctx);
    await showSettingDetails(ctx, ctx.match[1], true);
  }));

  bot.action(/settings:field:(performer|customer):([a-zA-Z]+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await promptSettingsFieldEdit(ctx, ctx.match[1], ctx.match[2]);
  }));

  bot.action("meal:add", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER, USER_ROLES.BARISTA)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const recent = await listRecentEmployees(4);
    const all = await listEmployees({ activeOnly: true, limit: PAGE_SIZE, offset: 0 });
    const merged = [...recent, ...all.filter((employee) => !recent.some((item) => item.id === employee.id))].slice(0, PAGE_SIZE);

    setFlow(ctx, "meal:add_pick_employee", "pick", {});
    await renderScreen(
      ctx,
      buildHtmlScreen("Добавить питание", "Выберите сотрудника для записи"),
      buildPagedKeyboard(merged, (employee) => employee.full_name, "meal:pickemployee", 0, false, [], "nav:home")
    );
  }));

  bot.action(/meal:pickemployee:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const employeeId = Number(ctx.match[1]);
    const employee = await getEmployeeById(employeeId);

    if (!employee) {
      await answerCb(ctx, "Сотрудник не найден");
      return;
    }

    if (flow?.name === "meal:edit:employee") {
      const updated = await updateMealEntry(flow.data.mealId || flow.data.id, {
        mealDate: flow.data.mealDate || flow.data.meal_date,
        employeeId,
        amount: flow.data.amount,
        comment: flow.data.comment,
        updatedByUserId: ctx.state.user.id
      });
      clearFlow(ctx);
      await answerCb(ctx, "Сотрудник изменён");
      await showMealDetail(ctx, updated.id);
      return;
    }

    await startMealAddForEmployee(ctx, employee);
  }));

  bot.action(/meal:add:repeat:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER, USER_ROLES.BARISTA)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const employee = await getEmployeeById(Number(ctx.match[1]));
    if (!employee || !employee.is_active) {
      await answerCb(ctx, "Сотрудник недоступен");
      return;
    }

    await startMealAddForEmployee(ctx, employee);
  }));

  bot.action("meal:add:amount_screen", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "meal:add") {
      await sendMainMenu(ctx);
      return;
    }

    flow.step = "amount";
    await promptMealAmount(ctx, flow.data.employeeName, flow.data.mealDate, flow.data.employeeId);
  }));

  bot.action("meal:add:change_date", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "meal:add") {
      await sendMainMenu(ctx);
      return;
    }

    flow.step = "date";
    await renderScreen(
      ctx,
      buildHtmlScreen("Дата питания", "Выберите дату записи", [
        lineHtml("Сотрудник", flow.data.employeeName),
        lineHtml("Текущая дата", formatDateRu(flow.data.mealDate))
      ]),
      buildMealDateKeyboard()
    );
  }));

  bot.action(/meal:amount:(custom|\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "meal:add" || flow.step !== "amount") {
      await sendMainMenu(ctx);
      return;
    }

    if (ctx.match[1] === "custom") {
      await promptMealAmount(ctx, flow.data.employeeName, flow.data.mealDate, flow.data.employeeId);
      return;
    }

    await saveMealFromFlow(ctx, flow, Number(ctx.match[1]));
  }));

  bot.action(/meal:list:(month_current|today|mine|custom)/, withError(async (ctx) => {
    await answerCb(ctx);
    const mode = ctx.match[1];
    if (mode === "custom") {
      setFlow(ctx, "period:custom:meals", "text", {});
      await renderScreen(ctx, buildHtmlScreen("Период питания", "Введите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"));
      return;
    }
    await showMealList(ctx, mode, 0);
  }));

  bot.action(/meal:listpage:(month_current|today|mine|custom):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showMealList(ctx, ctx.match[1], Number(ctx.match[2]));
  }));

  bot.action(/meal:view:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showMealDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action(/meal:edit:amount:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const meal = await getMealEntryById(Number(ctx.match[1]));
    if (!meal || !canManageMealEntry(ctx, meal)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "meal:edit:amount", "text", meal);
    await renderScreen(
      ctx,
      buildHtmlScreen("Изменить сумму", "Введите новую сумму", [
        lineHtml("Сотрудник", meal.employee_name),
        lineHtml("Дата", formatDateRu(meal.meal_date))
      ])
    );
  }));

  bot.action(/meal:edit:comment:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const meal = await getMealEntryById(Number(ctx.match[1]));
    if (!meal || !canManageMealEntry(ctx, meal)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "meal:edit:comment", "text", meal);
    await renderScreen(ctx, buildHtmlScreen(`Комментарий к записи #${meal.id}`, "Введите новый комментарий или '-'"));
  }));

  bot.action(/meal:edit:date:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const meal = await getMealEntryById(Number(ctx.match[1]));
    if (!meal || !canManageMealEntry(ctx, meal)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "meal:edit:date", "date", meal);
    await renderScreen(ctx, buildHtmlScreen("Изменить дату", "Выберите новую дату"), datePresetKeyboard("flow:date"));
  }));

  bot.action(/meal:edit:employee:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const meal = await getMealEntryById(Number(ctx.match[1]));
    if (!meal || !canManageMealEntry(ctx, meal)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    const employees = await listEmployees({ activeOnly: true, limit: PAGE_SIZE, offset: 0 });
    setFlow(ctx, "meal:edit:employee", "pick", meal);
    await renderScreen(
      ctx,
      buildHtmlScreen("Изменить сотрудника", "Выберите сотрудника для записи"),
      buildPagedKeyboard(employees, (employee) => employee.full_name, "meal:pickemployee", 0, false, [], "nav:meals")
    );
  }));

  bot.action(/meal:delete:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const meal = await getMealEntryById(Number(ctx.match[1]));
    if (!meal || !canManageMealEntry(ctx, meal)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await deleteMealEntry(meal.id);
    await sendMainMenu(ctx, "Запись питания удалена.");
  }));

  bot.action("advance:add", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "advance:add", "date", { returnTo: "nav:advances" });
    await renderScreen(ctx, buildHtmlScreen("Добавить аванс", "Выберите дату аванса"), buildAdvanceDateKeyboard("nav:advances"));
  }));

  bot.action("doc:advance:add", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "advance:add", "date", { returnTo: "doc:create_menu" });
    await renderScreen(ctx, buildHtmlScreen("Добавить аванс", "Выберите дату аванса"), buildAdvanceDateKeyboard("doc:create_menu"));
  }));

  bot.action("doc:advance:amount_screen", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow || flow.name !== "advance:add") {
      await showDocumentCreateMenu(ctx);
      return;
    }
    flow.step = "amount";
    await renderScreen(ctx, buildHtmlScreen("Добавить аванс", "Введите сумму аванса"), buildAdvanceAmountKeyboard(flow.data.returnTo === "nav:advances" ? "advance:add" : "doc:advance:add"));
  }));

  bot.action(/advance:list:(month_current|custom)/, withError(async (ctx) => {
    await answerCb(ctx);
    const mode = ctx.match[1];
    if (mode === "custom") {
      setFlow(ctx, "period:custom:advances", "text", {});
      await renderScreen(ctx, buildHtmlScreen("Период авансов", "Введите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"));
      return;
    }
    await showAdvanceList(ctx, mode, 0);
  }));

  bot.action(/advance:listpage:(month_current|custom):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showAdvanceList(ctx, ctx.match[1], Number(ctx.match[2]));
  }));

  bot.action(/advance:view:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showAdvanceDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action(/advance:edit:amount:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const advance = await getAdvanceById(Number(ctx.match[1]));
    if (!advance || !hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "advance:edit:amount", "text", advance);
    await renderScreen(ctx, buildHtmlScreen("Изменить аванс", "Введите новую сумму аванса"));
  }));

  bot.action(/advance:edit:comment:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const advance = await getAdvanceById(Number(ctx.match[1]));
    if (!advance || !hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "advance:edit:comment", "text", advance);
    await renderScreen(ctx, buildHtmlScreen("Комментарий к авансу", "Введите новый комментарий или '-'"));
  }));

  bot.action(/advance:edit:date:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const advance = await getAdvanceById(Number(ctx.match[1]));
    if (!advance || !hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "advance:edit:date", "date", advance);
    await renderScreen(ctx, buildHtmlScreen("Изменить дату аванса", "Выберите новую дату"), datePresetKeyboard("flow:date"));
  }));

  bot.action(/advance:delete:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await deleteAdvance(Number(ctx.match[1]));
    await sendMainMenu(ctx, "Аванс удалён.");
  }));

  bot.action("report:balance", withError(async (ctx) => {
    await answerCb(ctx);
    if (getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER) {
      await showClientDashboard(ctx);
      return;
    }
    await showBalance(ctx);
  }));

  bot.action("report:meals_month", withError(async (ctx) => {
    await answerCb(ctx);
    if (getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER) {
      const { month, year } = getSelectedReportMonth(ctx);
      await showClientMonthJournal(ctx, month, year, 0);
      return;
    }
    await showMonthlyMealsSummary(ctx);
  }));

  bot.action("journal:list", withError(async (ctx) => {
    await answerCb(ctx);
    if (getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER) {
      const { month, year } = getSelectedReportMonth(ctx);
      await showClientMonthJournal(ctx, month, year, 0);
      return;
    }
    await showJournal(ctx, 0);
  }));

  bot.action(/journal:list:page:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER) {
      const { month, year } = getSelectedReportMonth(ctx);
      await showClientMonthJournal(ctx, month, year, Number(ctx.match[1]));
      return;
    }
    await showJournal(ctx, Number(ctx.match[1]));
  }));

  bot.action(/journal:entry:(advance|meal):(\d+):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    const type = ctx.match[1];
    const id = Number(ctx.match[2]);
    const page = Number(ctx.match[3]);
    const backData = getDisplayedRole(ctx) === USER_ROLES.CLIENT_VIEWER
      ? `client:journal:page:${getSelectedReportMonth(ctx).year}:${getSelectedReportMonth(ctx).month}:${page}`
      : `journal:list:page:${page}`;

    if (type === "advance") {
      await showAdvanceDetail(ctx, id, { backData });
      return;
    }

    await showMealDetail(ctx, id, { backData });
  }));

  bot.action(/report:monthpicker:(root|journal|summary)/, withError(async (ctx) => {
    await answerCb(ctx);
    ctx.session.reportPickerYear = getSelectedReportMonth(ctx).year;
    await showReportMonthPicker(ctx, ctx.match[1]);
  }));

  bot.action(/report:month:shift:(root|journal|summary):(-?1)/, withError(async (ctx) => {
    const screen = ctx.match[1];
    const delta = Number(ctx.match[2]);
    const { month, year } = getSelectedReportMonth(ctx);
    const next = getAdjacentMonth(month, year, delta);
    const hasData = await reportMonthHasData(next.month, next.year);

    if (!hasData) {
      await answerCb(ctx, "данных нет");
      return;
    }

    await answerCb(ctx);
    setSelectedReportMonth(ctx, next.month, next.year);
    await openReportScreen(ctx, screen, 0);
  }));

  bot.action(/report:month:year:(root|journal|summary):(\d{4})/, withError(async (ctx) => {
    await answerCb(ctx);
    ensureSession(ctx);
    ctx.session.reportPickerYear = Number(ctx.match[2]);
    await showReportMonthPicker(ctx, ctx.match[1]);
  }));

  bot.action(/report:month:set:(root|journal|summary):(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    const screen = ctx.match[1];
    const year = Number(ctx.match[2]);
    const month = Number(ctx.match[3]);
    const hasData = await reportMonthHasData(month, year);

    if (!hasData) {
      await answerCb(ctx, "данных нет");
      return;
    }

    await answerCb(ctx);
    setSelectedReportMonth(ctx, month, year);
    await openReportScreen(ctx, screen, 0);
  }));

  bot.action(/report:month:back:(root|journal|summary)/, withError(async (ctx) => {
    await answerCb(ctx);
    await openReportScreen(ctx, ctx.match[1], 0);
  }));

  bot.action("doc:generate:act", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await showDocumentPeriodScreen(ctx, "act");
  }));

  bot.action("doc:act:month:custom", withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPeriodScreen(ctx, "act");
  }));

  bot.action("doc:act:picker", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const state = flow?.name === "doc:act" ? flow.data : await getDefaultDocumentFlowData("act");
    await showDocumentPeriodScreen(ctx, "act", state);
  }));

  bot.action(/doc:act:month:(current|previous)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPeriodScreen(ctx, "act", getDocumentMonthPeriod(ctx.match[1]));
  }));

  bot.action(/doc:act:pick:(start|end):(day|month|year)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPartPicker(ctx, "act", ctx.match[1], ctx.match[2]);
  }));

  bot.action(/doc:act:set:(start|end):(day|month|year):(\d{1,4})/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const state = flow?.name === "doc:act" ? flow.data : await getDefaultDocumentFlowData("act");
    await showDocumentPeriodScreen(
      ctx,
      "act",
      updateDocumentPeriodPart(state, ctx.match[1], ctx.match[2], ctx.match[3])
    );
  }));

  bot.action(/doc:act:month:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPeriodScreen(ctx, "act", getDocumentMonthPeriod("current"));
  }));

  bot.action("doc:act:apply", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const data = flow?.name === "doc:act" ? flow.data : await getDefaultDocumentFlowData("act");
    const startParts = getIsoDateParts(data.startDate);
    const document = await generateMonthlyAct({
      month: startParts.month,
      year: startParts.year,
      startDate: data.startDate,
      endDate: data.endDate,
      actDate: todayIso(),
      userId: ctx.state.user.id
    });
    clearFlow(ctx);
    await sendDocumentFile(ctx, document.id, false);
    await showDocumentCreateMenu(ctx);
  }));

  bot.action("doc:generate:reconciliation", withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await showReconciliationStartScreen(ctx);
  }));

  bot.action("doc:reconciliation:menu", withError(async (ctx) => {
    await answerCb(ctx);
    await showReconciliationStartScreen(ctx);
  }));

  bot.action("doc:reconciliation:custom", withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPeriodScreen(ctx, "reconciliation");
  }));

  bot.action(/doc:reconciliation:unsigned_previous:(strict|include)/, withError(async (ctx) => {
    await answerCb(ctx);
    const includeUnsignedPreviousMonth = ctx.match[1] === "include";
    const flow = currentFlow(ctx);
    const pendingUnsignedPreviousMonth = flow?.name === "doc:reconciliation:unsigned_previous_month"
      ? flow.data.pendingUnsignedPreviousMonth
      : await getUnsignedPreviousMonthActCandidate(todayIso());
    const data = await getDefaultDocumentFlowData("reconciliation", {
      includeUnsignedPreviousMonth,
      pendingUnsignedPreviousMonth
    });
    const document = await generateReconciliationDocument({
      startDate: data.startDate,
      endDate: data.endDate,
      includeUnsignedPreviousMonth,
      userId: ctx.state.user.id
    });

    clearFlow(ctx);
    await sendDocumentFile(ctx, document.id, false);
    await showDocumentCreateMenu(ctx);
  }));

  bot.action("doc:reconciliation:picker", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const state = flow?.name === "doc:reconciliation" ? flow.data : await getDefaultDocumentFlowData("reconciliation");
    await showDocumentPeriodScreen(ctx, "reconciliation", state);
  }));

  bot.action(/doc:reconciliation:month:(current|previous)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPeriodScreen(ctx, "reconciliation", getDocumentMonthPeriod(ctx.match[1]));
  }));

  bot.action(/doc:reconciliation:pick:(start|end):(day|month|year)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentPartPicker(ctx, "reconciliation", ctx.match[1], ctx.match[2]);
  }));

  bot.action(/doc:reconciliation:set:(start|end):(day|month|year):(\d{1,4})/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const state = flow?.name === "doc:reconciliation" ? flow.data : await getDefaultDocumentFlowData("reconciliation");
    await showDocumentPeriodScreen(
      ctx,
      "reconciliation",
      updateDocumentPeriodPart(state, ctx.match[1], ctx.match[2], ctx.match[3])
    );
  }));

  bot.action(/doc:reconciliation:month:(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    const year = Number(ctx.match[1]);
    const month = Number(ctx.match[2]);
    await showDocumentPeriodScreen(ctx, "reconciliation", {
      ...getMonthRange(month, year),
      selectedPreset: "custom"
    });
  }));

  bot.action("doc:reconciliation:apply", withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    const data = flow?.name === "doc:reconciliation" ? flow.data : await getDefaultDocumentFlowData("reconciliation");
    const document = await generateReconciliationDocument({
      startDate: data.startDate,
      endDate: data.endDate,
      includeUnsignedPreviousMonth: Boolean(data.includeUnsignedPreviousMonth),
      userId: ctx.state.user.id
    });
    clearFlow(ctx);
    await sendDocumentFile(ctx, document.id, false);
    await showDocumentCreateMenu(ctx);
  }));

  bot.action("doc:list:all", withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentList(ctx, null, 0);
  }));

  bot.action(/doc:view:page:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentList(ctx, null, Number(ctx.match[1]));
  }));

  bot.action(/doc:view:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await showDocumentDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action("doc:upload:no_document", withError(async (ctx) => {
    await answerCb(ctx, "Загрузите документ из экрана месяца");
  }));

  bot.action(/client:doc:uploadmonth:(act|reconciliation):(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    const docKind = ctx.match[1];
    const year = Number(ctx.match[2]);
    const month = Number(ctx.match[3]);
    setFlow(ctx, "doc:upload_signed", "document", {
      uploadMode: "month",
      docKind,
      returnTo: "client_month",
      year,
      month
    });
    await renderScreen(ctx, buildHtmlScreen("Загрузить подписанный файл", "Отправьте документ в этот чат"));
  }));

  bot.action(/client:doc:uploadsigned:(\d+):(\d{4}):(\d{1,2})/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }

    setFlow(ctx, "doc:upload_signed", "document", {
      documentId: Number(ctx.match[1]),
      returnTo: "client_month",
      year: Number(ctx.match[2]),
      month: Number(ctx.match[3])
    });
    await renderScreen(ctx, buildHtmlScreen("Загрузить подписанный файл", "Отправьте подписанный документ в этот чат"));
  }));

  bot.action(/doc:send:(generated|signed):(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    await sendDocumentFile(ctx, Number(ctx.match[2]), ctx.match[1] === "signed");
  }));

  bot.action(/doc:sent:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    await markDocumentSent(Number(ctx.match[1]));
    await answerCb(ctx, "Документ отмечен как отправленный");
    await showDocumentDetail(ctx, Number(ctx.match[1]));
  }));

  bot.action(/doc:uploadsigned:(\d+)/, withError(async (ctx) => {
    await answerCb(ctx);
    if (!hasDisplayedRole(ctx, USER_ROLES.OWNER)) {
      await answerCb(ctx, "Недостаточно прав");
      return;
    }
    setFlow(ctx, "doc:upload_signed", "document", { documentId: Number(ctx.match[1]) });
    await renderScreen(ctx, buildHtmlScreen("Загрузить подписанный файл", "Отправьте подписанный документ в этот чат"));
  }));

  bot.action(/flow:date:(today|yesterday|custom)/, withError(async (ctx) => {
    await answerCb(ctx);
    const flow = currentFlow(ctx);
    if (!flow) {
      await sendMainMenu(ctx);
      return;
    }

    const preset = ctx.match[1];
    const isoDate = preset === "today" ? todayIso() : yesterdayIso();

    if (flow.name === "meal:add") {
      if (preset === "custom") {
        flow.step = "date_custom";
        await renderScreen(
          ctx,
          buildHtmlScreen("Дата питания", "Введите дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"),
          buildMealDateKeyboard()
        );
        return;
      }
      flow.data.mealDate = isoDate;
      flow.step = "amount";
      await promptMealAmount(ctx, flow.data.employeeName, flow.data.mealDate, flow.data.employeeId);
      return;
    }

    if (flow.name === "meal:edit:date") {
      if (preset === "custom") {
        flow.step = "date_custom";
        await renderScreen(ctx, buildHtmlScreen("Изменить дату", "Введите новую дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"));
        return;
      }
      const updated = await updateMealEntry(flow.data.mealId || flow.data.id, {
        mealDate: isoDate,
        employeeId: flow.data.employeeId || flow.data.employee_id,
        amount: flow.data.amount,
        comment: flow.data.comment,
        updatedByUserId: ctx.state.user.id
      });
      clearFlow(ctx);
      await answerCb(ctx, "Дата обновлена");
      await showMealDetail(ctx, updated.id);
      return;
    }

    if (flow.name === "advance:add") {
      if (preset === "custom") {
        flow.step = "date_custom";
        await renderScreen(ctx, buildHtmlScreen("Дата аванса", "Введите дату в формате ДД.ММ.ГГГГ или YYYY-MM-DD"), buildAdvanceDateKeyboard(flow.data.returnTo || "doc:create_menu"));
        return;
      }
      flow.data.paymentDate = isoDate;
      flow.step = "amount";
      await renderScreen(ctx, buildHtmlScreen("Добавить аванс", "Введите сумму аванса"), buildAdvanceAmountKeyboard(flow.data.returnTo === "nav:advances" ? "advance:add" : "doc:advance:add"));
      return;
    }

    if (flow.name === "advance:edit:date") {
      if (preset === "custom") {
        flow.step = "date_custom";
        await renderScreen(ctx, buildHtmlScreen("Изменить дату аванса", "Введите новую дату"));
        return;
      }
      const updated = await updateAdvance(flow.data.advanceId || flow.data.id, {
        paymentDate: isoDate,
        amount: flow.data.amount,
        comment: flow.data.comment,
        updatedByUserId: ctx.state.user.id
      });
      clearFlow(ctx);
      await answerCb(ctx, "Дата обновлена");
      await showAdvanceDetail(ctx, updated.id);
    }
  }));

  bot.on("document", withError(async (ctx) => {
    await handleDocumentUpload(ctx);
  }));

  bot.on("text", withError(async (ctx) => {
    await handleTextFlow(ctx, String(ctx.message.text || "").trim());
  }));
}

module.exports = {
  registerHandlers
};
