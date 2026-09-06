const { createHash } = require("crypto");
const fs = require("fs/promises");
const ExcelJS = require("exceljs");
const pool = require("../db/pool");
const { DAILY_LIMIT } = require("../constants");
const { getMonthRange } = require("../utils/dateHelpers");
const { getMonthUploadedDocument } = require("./monthDocumentService");
const {
  ensureMealMonthStateSchema,
  saveMealMonthConfirmation
} = require("./mealMonthService");

const MEAL_MARKS = new Set(["П"]);
const NO_MEAL_MARKS = new Set(["НЕТ", "ОТП", "ОТ", "Б", "БОЛ", "В", "ВЫХ", "-", "0"]);
const REQUIRED_HEADERS = ["СОТРУДНИК", "ДНЕЙ"];

let ensureEmployeeImportSchemaPromise = null;

async function ensureEmployeeImportSchema() {
  if (!ensureEmployeeImportSchemaPromise) {
    ensureEmployeeImportSchemaPromise = (async () => {
      await pool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS external_employee_number TEXT");
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_external_number_unique
        ON employees(external_employee_number)
        WHERE external_employee_number IS NOT NULL AND BTRIM(external_employee_number) <> ''
      `);
    })().catch((error) => {
      ensureEmployeeImportSchemaPromise = null;
      throw error;
    });
  }

  await ensureEmployeeImportSchemaPromise;
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return normalizeWhitespace(value).toUpperCase().replace(/Ё/g, "Е");
}

function normalizeEmployeeName(value) {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/[^А-ЯA-Z0-9]/g, "");
}

function normalizeEmployeeNumber(value) {
  const normalized = normalizeWhitespace(value).replace(/\s+/g, "");
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return normalized.replace(/^0+(?=\d)/, "");
  }

  return normalized.toUpperCase();
}

function getCellText(cell) {
  if (!cell) {
    return "";
  }

  if (cell.value && typeof cell.value === "object") {
    if (Array.isArray(cell.value.richText)) {
      return normalizeWhitespace(cell.value.richText.map((part) => part.text || "").join(""));
    }
    if (cell.value.result != null) {
      return normalizeWhitespace(cell.value.result);
    }
    if (cell.value.text != null) {
      return normalizeWhitespace(cell.value.text);
    }
  }

  return normalizeWhitespace(cell.text || cell.value || "");
}

function parseSheetPeriod(sheetName) {
  const match = normalizeWhitespace(sheetName).match(/ЖУРНАЛ\s+ПИТАНИЯ\s+ЗА\s+(\d{1,2})\s+(\d{4})/i);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000) {
    return null;
  }

  return { month, year };
}

function parseDeclaredDays(cell) {
  if (typeof cell?.value === "number" && Number.isFinite(cell.value)) {
    return Number(cell.value);
  }

  const text = getCellText(cell).replace(",", ".");
  if (!text) {
    return null;
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function findHeaderRow(worksheet) {
  const maxRows = Math.min(Math.max(worksheet.rowCount || 0, 1), 20);
  const maxColumns = Math.min(Math.max(worksheet.columnCount || 0, 1), 80);

  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headers = new Map();
    const dayColumns = new Map();

    for (let column = 1; column <= maxColumns; column += 1) {
      const text = normalizeHeader(getCellText(row.getCell(column)));
      if (!text) {
        continue;
      }

      if (/^\d{1,2}$/.test(text)) {
        const day = Number(text);
        if (day >= 1 && day <= 31) {
          dayColumns.set(day, column);
        }
      } else {
        headers.set(text, column);
      }
    }

    if (REQUIRED_HEADERS.every((header) => headers.has(header)) && dayColumns.size >= 28) {
      return { rowNumber, headers, dayColumns };
    }
  }

  return null;
}

function getHeaderColumn(headers, ...names) {
  for (const name of names) {
    const column = headers.get(name);
    if (column) {
      return column;
    }
  }
  return null;
}

async function parseRailshipReportFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const candidates = workbook.worksheets
    .map((worksheet) => ({ worksheet, period: parseSheetPeriod(worksheet.name) }))
    .filter((item) => item.period);

  if (!candidates.length) {
    throw new Error("Не найден лист вида «Журнал питания за ММ ГГГГ»");
  }

  let selected = null;
  for (const candidate of candidates) {
    const header = findHeaderRow(candidate.worksheet);
    if (header) {
      selected = { ...candidate, header };
      break;
    }
  }

  if (!selected) {
    throw new Error("В отчёте не найдена таблица с колонками «СОТРУДНИК», «ДНЕЙ» и днями месяца");
  }

  const { worksheet, period, header } = selected;
  const employeeColumn = getHeaderColumn(header.headers, "СОТРУДНИК");
  const employeeNumberColumn = getHeaderColumn(header.headers, "ТАБЕЛЬНЫЙ НОМЕР", "ТАБЕЛЬНЫЙ №", "ТАБ. НОМЕР");
  const departmentColumn = getHeaderColumn(header.headers, "ПОДРАЗДЕЛЕНИЕ");
  const cityColumn = getHeaderColumn(header.headers, "ГОРОД");
  const daysColumn = getHeaderColumn(header.headers, "ДНЕЙ");
  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  const errors = [];
  const warnings = [];
  const employees = [];
  const seenNumbers = new Map();
  const seenNames = new Map();

  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const fullName = getCellText(row.getCell(employeeColumn));
    const personnelNumber = employeeNumberColumn ? getCellText(row.getCell(employeeNumberColumn)) : "";
    const department = departmentColumn ? getCellText(row.getCell(departmentColumn)) : "";
    const city = cityColumn ? getCellText(row.getCell(cityColumn)) : "";
    const declaredDays = parseDeclaredDays(row.getCell(daysColumn));
    const hasAnyIdentity = Boolean(fullName || personnelNumber);

    if (!hasAnyIdentity) {
      continue;
    }

    if (!fullName) {
      errors.push(`Строка ${rowNumber}: не указано ФИО сотрудника`);
      continue;
    }

    const mealDays = [];
    for (const [day, column] of [...header.dayColumns.entries()].sort((a, b) => a[0] - b[0])) {
      const rawMark = normalizeHeader(getCellText(row.getCell(column)));
      if (!rawMark) {
        continue;
      }

      if (day > daysInMonth) {
        errors.push(`Строка ${rowNumber}: отметка «${rawMark}» стоит в несуществующем дне ${day}`);
        continue;
      }

      if (MEAL_MARKS.has(rawMark)) {
        mealDays.push(day);
        continue;
      }

      if (!NO_MEAL_MARKS.has(rawMark)) {
        errors.push(`Строка ${rowNumber}, день ${day}: неизвестная отметка «${rawMark}»`);
      }
    }

    if (declaredDays == null) {
      errors.push(`Строка ${rowNumber}: значение «ДНЕЙ» не является числом`);
    } else if (declaredDays !== mealDays.length) {
      errors.push(
        `Строка ${rowNumber}: в «ДНЕЙ» указано ${declaredDays}, а отметок «П» найдено ${mealDays.length}`
      );
    }

    const normalizedName = normalizeEmployeeName(fullName);
    const normalizedNumber = normalizeEmployeeNumber(personnelNumber);

    if (normalizedName) {
      if (seenNames.has(normalizedName)) {
        errors.push(`Сотрудник «${fullName}» встречается в отчёте более одного раза`);
      } else {
        seenNames.set(normalizedName, rowNumber);
      }
    }

    if (normalizedNumber) {
      if (seenNumbers.has(normalizedNumber)) {
        errors.push(`Табельный номер «${personnelNumber}» встречается в отчёте более одного раза`);
      } else {
        seenNumbers.set(normalizedNumber, rowNumber);
      }
    }

    employees.push({
      rowNumber,
      fullName,
      personnelNumber: personnelNumber || null,
      normalizedName,
      normalizedNumber,
      department: department || null,
      city: city || null,
      declaredDays,
      mealDays,
      daysCount: mealDays.length,
      amount: Number((mealDays.length * DAILY_LIMIT).toFixed(2))
    });
  }

  if (!employees.length) {
    errors.push("В отчёте не найдено ни одного сотрудника");
  }

  const fileBuffer = await fs.readFile(filePath);
  const fileSha256 = createHash("sha256").update(fileBuffer).digest("hex");

  return {
    sheetName: worksheet.name,
    month: period.month,
    year: period.year,
    daysInMonth,
    employees,
    errors,
    warnings,
    fileSha256
  };
}

function buildEmployeeIndexes(rows) {
  const byNumber = new Map();
  const byName = new Map();

  for (const employee of rows) {
    const number = normalizeEmployeeNumber(employee.external_employee_number);
    if (number) {
      byNumber.set(number, employee);
    }

    const name = normalizeEmployeeName(employee.full_name);
    if (name) {
      const existing = byName.get(name) || [];
      existing.push(employee);
      byName.set(name, existing);
    }
  }

  return { byNumber, byName };
}

async function hasSignedActForMonth(year, month) {
  const { startDate, endDate } = getMonthRange(month, year);
  const [{ rows }, uploadedAct] = await Promise.all([
    pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM generated_documents
          WHERE doc_type = 'act'
            AND period_start::DATE = $1
            AND period_end::DATE = $2
            AND signed_file_path IS NOT NULL
        ) AS has_signed_act
      `,
      [startDate, endDate]
    ),
    getMonthUploadedDocument("act", year, month)
  ]);

  return Boolean(rows[0]?.has_signed_act || uploadedAct);
}

async function prepareRailshipReportImport({
  filePath,
  originalFileName = null,
  expectedYear = null,
  expectedMonth = null
}) {
  await Promise.all([ensureEmployeeImportSchema(), ensureMealMonthStateSchema()]);
  const report = await parseRailshipReportFile(filePath);
  const errors = [...report.errors];
  const warnings = [...report.warnings];

  if (expectedYear && expectedMonth && (report.year !== Number(expectedYear) || report.month !== Number(expectedMonth))) {
    errors.push(
      `Отчёт относится к ${String(report.month).padStart(2, "0")}.${report.year}, а бот ожидает ${String(expectedMonth).padStart(2, "0")}.${expectedYear}`
    );
  }

  if (await hasSignedActForMonth(report.year, report.month)) {
    errors.push("За этот месяц уже загружен подписанный акт. Изменение данных заблокировано");
  }

  const { rows: employeeRows } = await pool.query(
    `
      SELECT id, full_name, external_employee_number, is_active
      FROM employees
      ORDER BY id ASC
    `
  );
  const indexes = buildEmployeeIndexes(employeeRows);
  const resolvedEmployeeIds = new Set();
  const resolvedEmployees = report.employees.map((item) => {
    const numberMatch = item.normalizedNumber ? indexes.byNumber.get(item.normalizedNumber) || null : null;
    const nameMatches = item.normalizedName ? indexes.byName.get(item.normalizedName) || [] : [];
    const nameMatch = nameMatches.length === 1 ? nameMatches[0] : null;

    if (nameMatches.length > 1 && !numberMatch) {
      errors.push(`Не удалось однозначно сопоставить сотрудника «${item.fullName}» по ФИО`);
    }

    if (numberMatch && nameMatch && Number(numberMatch.id) !== Number(nameMatch.id)) {
      errors.push(
        `Табельный номер ${item.personnelNumber} и ФИО «${item.fullName}» относятся к разным сотрудникам в боте`
      );
    }

    const matched = numberMatch || nameMatch || null;
    if (matched && resolvedEmployeeIds.has(Number(matched.id))) {
      errors.push(`Несколько строк отчёта сопоставились с сотрудником «${matched.full_name}»`);
    }
    if (matched) {
      resolvedEmployeeIds.add(Number(matched.id));
    }

    const existingNumber = matched ? normalizeEmployeeNumber(matched.external_employee_number) : null;
    if (matched && item.normalizedNumber && existingNumber && existingNumber !== item.normalizedNumber) {
      errors.push(
        `У сотрудника «${matched.full_name}» уже сохранён другой табельный номер`
      );
    }

    if (matched && matched.full_name !== item.fullName) {
      warnings.push(`«${item.fullName}» сопоставлен с «${matched.full_name}»`);
    }

    return {
      ...item,
      employeeId: matched ? Number(matched.id) : null,
      employeeName: matched?.full_name || item.fullName,
      willCreateEmployee: !matched,
      willLinkEmployeeNumber: Boolean(matched && item.normalizedNumber && !existingNumber)
    };
  });

  const { startDate, endDate } = getMonthRange(report.month, report.year);
  const { rows: existingRows } = await pool.query(
    `
      SELECT
        employee_id,
        meal_date::TEXT AS meal_date,
        COUNT(*)::INT AS entries_count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM meal_entries
      WHERE meal_date BETWEEN $1 AND $2
      GROUP BY employee_id, meal_date
      ORDER BY employee_id, meal_date
    `,
    [startDate, endDate]
  );

  const existingByKey = new Map(
    existingRows.map((row) => [
      `${Number(row.employee_id)}:${String(row.meal_date).slice(0, 10)}`,
      {
        entriesCount: Number(row.entries_count || 0),
        totalAmount: Number(row.total_amount || 0)
      }
    ])
  );
  const expectedKeys = new Set();
  let toAdd = 0;
  let unchanged = 0;
  let toReplace = 0;

  for (const employee of resolvedEmployees) {
    if (!employee.employeeId) {
      toAdd += employee.mealDays.length;
      continue;
    }

    for (const day of employee.mealDays) {
      const date = `${report.year}-${String(report.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const key = `${employee.employeeId}:${date}`;
      expectedKeys.add(key);
      const existing = existingByKey.get(key);
      if (!existing) {
        toAdd += 1;
      } else if (existing.entriesCount === 1 && Math.abs(existing.totalAmount - DAILY_LIMIT) < 0.005) {
        unchanged += 1;
      } else {
        toReplace += 1;
      }
    }
  }

  const toRemove = existingRows.filter((row) => {
    const key = `${Number(row.employee_id)}:${String(row.meal_date).slice(0, 10)}`;
    return !expectedKeys.has(key);
  }).length;
  const totalDays = resolvedEmployees.reduce((sum, employee) => sum + employee.daysCount, 0);
  const totalAmount = Number((totalDays * DAILY_LIMIT).toFixed(2));

  return {
    version: 1,
    filePath,
    originalFileName,
    fileSha256: report.fileSha256,
    sheetName: report.sheetName,
    year: report.year,
    month: report.month,
    startDate,
    endDate,
    dailyAmount: DAILY_LIMIT,
    employees: resolvedEmployees,
    summary: {
      employeeCount: resolvedEmployees.length,
      newEmployeeCount: resolvedEmployees.filter((item) => item.willCreateEmployee).length,
      linkedNumberCount: resolvedEmployees.filter((item) => item.willLinkEmployeeNumber).length,
      totalDays,
      totalAmount
    },
    diff: {
      toAdd,
      unchanged,
      toReplace,
      toRemove
    },
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
    canApply: errors.length === 0
  };
}

async function applyRailshipReportImport({
  filePath,
  originalFileName = null,
  expectedYear = null,
  expectedMonth = null,
  userId = null
}) {
  await Promise.all([ensureEmployeeImportSchema(), ensureMealMonthStateSchema()]);
  const preview = await prepareRailshipReportImport({
    filePath,
    originalFileName,
    expectedYear,
    expectedMonth
  });

  if (!preview.canApply) {
    throw new Error(preview.errors[0] || "Отчёт не прошёл проверку");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const advisoryKey = preview.year * 100 + preview.month;
    await client.query("SELECT pg_advisory_xact_lock($1)", [581000000 + advisoryKey]);

    const { rows: signedRows } = await client.query(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM generated_documents
            WHERE doc_type = 'act'
              AND period_start::DATE = $1
              AND period_end::DATE = $2
              AND signed_file_path IS NOT NULL
          )
          OR EXISTS (
            SELECT 1
            FROM month_uploaded_documents
            WHERE doc_kind = 'act'
              AND doc_year = $3
              AND doc_month = $4
          ) AS has_signed_act
      `,
      [preview.startDate, preview.endDate, preview.year, preview.month]
    );
    if (signedRows[0]?.has_signed_act) {
      throw new Error("За этот месяц уже есть подписанный акт. Данные изменять нельзя");
    }

    const resolved = [];
    for (const employee of preview.employees) {
      let employeeId = employee.employeeId;
      if (employeeId) {
        const locked = await client.query(
          "SELECT id FROM employees WHERE id = $1 FOR UPDATE",
          [employeeId]
        );
        if (!locked.rows[0]) {
          throw new Error(`Сотрудник «${employee.employeeName}» больше не найден. Загрузите отчёт заново`);
        }
      } else {
        const inserted = await client.query(
          `
            INSERT INTO employees (full_name, note, is_active, created_at, updated_at)
            VALUES ($1, NULL, true, NOW(), NOW())
            ON CONFLICT (full_name)
            DO UPDATE SET is_active = true, updated_at = NOW()
            RETURNING id
          `,
          [employee.fullName]
        );
        employeeId = Number(inserted.rows[0].id);
      }

      if (employee.normalizedNumber) {
        await client.query(
          `
            UPDATE employees
            SET external_employee_number = $2,
                is_active = true,
                updated_at = NOW()
            WHERE id = $1
          `,
          [employeeId, employee.normalizedNumber]
        );
      }

      resolved.push({ ...employee, employeeId });
    }

    await client.query(
      `
        DELETE FROM meal_entries
        WHERE meal_date BETWEEN $1 AND $2
      `,
      [preview.startDate, preview.endDate]
    );

    const dates = [];
    const entryEmployeeIds = [];
    const amounts = [];
    const comments = [];
    const creators = [];
    const comment = originalFileName
      ? `Импорт отчёта Railship: ${originalFileName}`
      : "Импорт отчёта Railship";

    for (const employee of resolved) {
      for (const day of employee.mealDays) {
        dates.push(`${preview.year}-${String(preview.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
        entryEmployeeIds.push(employee.employeeId);
        amounts.push(DAILY_LIMIT);
        comments.push(comment);
        creators.push(userId);
      }
    }

    if (dates.length) {
      await client.query(
        `
          INSERT INTO meal_entries (
            meal_date,
            employee_id,
            amount,
            comment,
            created_by_user_id,
            updated_by_user_id,
            created_at,
            updated_at
          )
          SELECT meal_date, employee_id, amount, comment, creator_id, creator_id, NOW(), NOW()
          FROM UNNEST(
            $1::DATE[],
            $2::BIGINT[],
            $3::NUMERIC[],
            $4::TEXT[],
            $5::BIGINT[]
          ) AS imported(meal_date, employee_id, amount, comment, creator_id)
        `,
        [dates, entryEmployeeIds, amounts, comments, creators]
      );
    }

    await saveMealMonthConfirmation({
      year: preview.year,
      month: preview.month,
      sourceType: "excel",
      sourceFilePath: filePath,
      originalFileName,
      sourceFileSha256: preview.fileSha256,
      totalDays: preview.summary.totalDays,
      totalAmount: preview.summary.totalAmount,
      userId
    }, client);

    await client.query("COMMIT");
    return {
      ...preview,
      employees: resolved,
      applied: true
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  applyRailshipReportImport,
  ensureEmployeeImportSchema,
  normalizeEmployeeName,
  normalizeEmployeeNumber,
  parseRailshipReportFile,
  prepareRailshipReportImport
};
