# Railship Bot Notes

Актуальная версия проекта теперь работает как бот для одной компании `Railship`, а не как мультиклиентский MVP.

Главные особенности текущей версии:
- роли `owner`, `barista`, `client_viewer`;
- сотрудники Railship по ФИО;
- лимит `300 ₽` на сотрудника в день;
- авансы и питание отдельно;
- inline-меню;
- акты и сверки;
- архив подписанных документов;
- реквизиты сторон в базе.

## Быстрый запуск

1. Установить зависимости:

```powershell
npm install
```

2. Создать БД:

```sql
CREATE DATABASE corp_settlements_bot;
```

3. Применить схему:

```powershell
npm run db:init
```

4. Скопировать [`.env.example`](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/.env.example) в [`.env`](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/.env) и заполнить:

```env
BOT_TOKEN=
DATABASE_URL=
DB_HOST=localhost
DB_PORT=5432
DB_NAME=corp_settlements_bot
DB_USER=postgres
DB_PASSWORD=
ADMIN_IDS=
```

Важно:
- если используете `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`, оставляйте `DATABASE_URL=` пустым;
- `ADMIN_IDS` должен содержать ваш Telegram user ID;
- первый owner создаётся автоматически из `ADMIN_IDS`.

5. Запустить бота:

```powershell
npm start
```

## Ключевые новые файлы

- [schema.sql](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/src/db/schema.sql)
- [railshipHandlers.js](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/src/bot/railshipHandlers.js)
- [ui.js](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/src/bot/ui.js)
- [mealService.js](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/src/services/mealService.js)
- [advanceService.js](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/src/services/advanceService.js)
- [documentService.js](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/src/services/documentService.js)

## Архив документов

Система хранит:
- исходный сформированный документ;
- подписанный документ;
- статус `generated / sent / signed`.

Подписанный файл загружается обратно в бот документом и сохраняется в архиве.

## Тестирование

Для первого прохода используйте чек-лист из [TESTING_CHECKLIST.md](c:/Users/Павел/OneDrive/Desktop/Мои%20проекты/meal-accounting-bot/corp-meals-telegram-bot/TESTING_CHECKLIST.md).
