const { Markup } = require("telegraf");
const { USER_ROLES } = require("../constants");

function mainMenu(role) {
  if (role === USER_ROLES.OWNER) {
    const rows = [
      [Markup.button.callback("📄 Отчёты и документы", "nav:reports")],
      [Markup.button.callback("➕ Добавить питание", "meal:add")],
      [Markup.button.callback("⚙️ Настройки", "nav:settings")]
    ];
    return Markup.inlineKeyboard(rows);
  }

  if (role === USER_ROLES.BARISTA) {
    const rows = [
      [Markup.button.callback("➕ Добавить питание", "meal:add")]
    ];
    return Markup.inlineKeyboard(rows);
  }

  const rows = [
    [Markup.button.callback("📄 Документы", "nav:documents"), Markup.button.callback("🔄 Обновить", "client:home:refresh")]
  ];

  return Markup.inlineKeyboard(rows);
}

function backHomeKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("🔙", "nav:home")]]);
}

function datePresetKeyboard(actionPrefix) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Сегодня", `${actionPrefix}:today`), Markup.button.callback("Вчера", `${actionPrefix}:yesterday`)],
    [Markup.button.callback("Ввести дату", `${actionPrefix}:custom`)],
    [Markup.button.callback("Отмена", "nav:home")]
  ]);
}

function periodPresetKeyboard(actionPrefix) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Текущий месяц", `${actionPrefix}:month_current`)],
    [Markup.button.callback("Сегодня", `${actionPrefix}:today`), Markup.button.callback("Вчера", `${actionPrefix}:yesterday`)],
    [Markup.button.callback("Ввести период", `${actionPrefix}:custom`)],
    [Markup.button.callback("🔙", "nav:home")]
  ]);
}

function rolePreviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Owner", "role:set:owner"), Markup.button.callback("Barista", "role:set:barista")],
    [Markup.button.callback("Client", "role:set:client_viewer"), Markup.button.callback("Сбросить", "role:set:reset")],
    [Markup.button.callback("🔙", "nav:home")]
  ]);
}

function pagedListKeyboard(items, buildLabel, callbackPrefix, page, totalPages, extraRows = [], backData = "nav:home") {
  const rows = items.map((item) => [Markup.button.callback(buildLabel(item), `${callbackPrefix}:${item.id}`)]);
  const navRow = [];

  if (page > 0) {
    navRow.push(Markup.button.callback("<", `${callbackPrefix}:page:${page - 1}`));
  }

  if (totalPages > 1) {
    navRow.push(Markup.button.callback(`${page + 1}/${totalPages}`, "noop"));
  }

  if (page < totalPages - 1) {
    navRow.push(Markup.button.callback(">", `${callbackPrefix}:page:${page + 1}`));
  }

  if (navRow.length) {
    rows.push(navRow);
  }

  rows.push(...extraRows);
  rows.push([Markup.button.callback("🔙", backData)]);

  return Markup.inlineKeyboard(rows);
}

module.exports = {
  backHomeKeyboard,
  datePresetKeyboard,
  mainMenu,
  pagedListKeyboard,
  periodPresetKeyboard,
  rolePreviewKeyboard
};
