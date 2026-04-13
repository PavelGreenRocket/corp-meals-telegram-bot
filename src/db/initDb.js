const fs = require("fs");
const path = require("path");
const pool = require("./pool");

async function initDb() {
  const sqlPath = path.resolve(__dirname, "schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  try {
    await pool.query(sql);
    console.log("Схема БД и тестовые данные успешно применены.");
  } catch (error) {
    console.error("Ошибка инициализации БД:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

initDb();
