# Access invariants

- Railship users with `receives_meals=true` are self-service meal users at runtime.
- Self-service users may record meals only for their linked `employee_id`.
- Employee linkage for self-service users is assigned by an administrator, not by the employee choosing from the full employee list.
- Administrative callbacks and administrative text flows require the current runtime role `owner`; stale Telegram buttons must not preserve old privileges.
- Financial/document reminders exclude Railship self-service meal users.
- The 300 ₽ daily meal limit is enforced inside a transaction under a per-employee/per-day advisory lock.
