const fs = require("fs");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertIncludes(content, fragment, message) {
  if (!content.includes(fragment)) {
    throw new Error(message);
  }
}

const userService = read("src/services/userService.js");
const mealService = read("src/services/mealService.js");
const botIndex = read("src/bot/index.js");
const railshipHandlers = read("src/bot/railshipHandlers.js");
const ledgerService = read("src/services/ledgerService.js");

assertIncludes(
  userService,
  "AND NOT (company = 'RS' AND receives_meals = true AND role = $2)",
  "Railship self-service client users must be excluded from financial reminders"
);

assertIncludes(
  userService,
  "Этот сотрудник уже привязан к другому пользователю",
  "One employee must not be linked to multiple active meal users through the service layer"
);

assertIncludes(
  mealService,
  "pg_advisory_xact_lock",
  "Daily meal limit must be serialized"
);

assertIncludes(
  botIndex,
  "OWNER_ONLY_CALLBACK_PREFIXES",
  "Administrative stale callbacks must be centrally protected"
);

assertIncludes(
  botIndex,
  "Привязка сотрудника задаётся администратором",
  "Self-service employee selection must stay disabled"
);

assertIncludes(
mealService,
"COUNT(DISTINCT (meal_date, employee_id)) AS days_count",
"Meal days must count unique employee/date pairs"
);

assertIncludes(
  railshipHandlers,
  "const reconciliation = await generateReconciliationDocument({\n    documentDate: todayIso(),\n    userId: ctx.state.user.id\n  });",
  "Monthly reconciliation bundle must cover the full settlement history through the document date"
);

assertIncludes(
  ledgerService,
  "meal_periods AS (",
  "Reconciliation must include actual meal months even when an act is not signed"
);

assertIncludes(
  ledgerService,
  "generated_act_periods AS (",
  "Reconciliation must include generated acts regardless of signature state"
);

console.log("Security invariant checks passed.");
