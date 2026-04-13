const https = require("https");
const { Telegraf, session } = require("telegraf");
const config = require("../config");
const { resolveAccessUser } = require("../services/userService");
const { registerHandlers } = require("./railshipHandlers");

function createBot() {
  const agent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    family: 4
  });

  const bot = new Telegraf(config.botToken, {
    telegram: {
      agent,
      attachmentAgent: agent
    }
  });

  bot.use(session());

  bot.use(async (ctx, next) => {
    if (!ctx.from) {
      return;
    }

    const accessUser = await resolveAccessUser(ctx.from, config.adminIds);

    if (!accessUser) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery("Нет доступа", { show_alert: true });
        return;
      }
      await ctx.reply("Нет доступа");
      return;
    }

    ctx.state.user = accessUser;
    return next();
  });

  registerHandlers(bot);
  return bot;
}

module.exports = createBot;
