const { Markup } = require("telegraf");

const MAIN_MENU = Markup.keyboard(
  [
    ["Клиенты"],
    ["Добавить аванс", "Добавить питание"],
    ["Остаток аванса", "История операций"],
    ["Сформировать акт", "Сформировать акт сверки"],
    ["Сформировать реестр"],
    ["Отмена"]
  ],
  { columns: 2 }
)
  .resize()
  .persistent();

function clientsSectionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Список клиентов", "clients:list")],
    [Markup.button.callback("Добавить клиента", "clients:add")]
  ]);
}

function clientsListKeyboard(clients) {
  if (!clients.length) {
    return Markup.inlineKeyboard([]);
  }

  const rows = clients.map((client) => [
    Markup.button.callback(client.short_name, `client:card:${client.id}`)
  ]);
  return Markup.inlineKeyboard(rows);
}

function clientSelectionKeyboard(clients, action) {
  if (!clients.length) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Отмена", "flow:cancel")]
    ]);
  }

  const rows = clients.map((client) => [
    Markup.button.callback(client.short_name, `select_client:${action}:${client.id}`)
  ]);
  rows.push([Markup.button.callback("Отмена", "flow:cancel")]);
  return Markup.inlineKeyboard(rows);
}

module.exports = {
  MAIN_MENU,
  clientsSectionKeyboard,
  clientsListKeyboard,
  clientSelectionKeyboard
};
