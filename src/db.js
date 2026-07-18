import pg from "pg";

const { Pool } = pg;

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
      }
    : {
        host: process.env.DATABASE_HOST,
        port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
      },
);

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(30) NOT NULL,
      channel_id VARCHAR(30) NOT NULL,
      content TEXT NOT NULL,
      remind_at TIMESTAMPTZ NOT NULL,
      sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("remindersテーブルを確認しました");
}

export async function createReminder({
  userId,
  channelId,
  content,
  remindAt,
}) {
  const result = await pool.query(
    `
      INSERT INTO reminders (
        user_id,
        channel_id,
        content,
        remind_at
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [userId, channelId, content, remindAt],
  );

  return result.rows[0];
}

export async function getUserReminders(userId) {
  const result = await pool.query(
    `
      SELECT id, content, remind_at
      FROM reminders
      WHERE user_id = $1
        AND sent = FALSE
      ORDER BY remind_at ASC
    `,
    [userId],
  );

  return result.rows;
}

export async function getDueReminders() {
  const result = await pool.query(`
    SELECT id, user_id, channel_id, content, remind_at
    FROM reminders
    WHERE sent = FALSE
      AND remind_at <= CURRENT_TIMESTAMP
    ORDER BY remind_at ASC
  `);

  return result.rows;
}

export async function markReminderAsSent(id) {
  await pool.query(
    `
      UPDATE reminders
      SET sent = TRUE
      WHERE id = $1
    `,
    [id],
  );
}

export async function deleteReminder(id, userId) {
  const result = await pool.query(
    `
      DELETE FROM reminders
      WHERE id = $1
        AND user_id = $2
        AND sent = FALSE
      RETURNING id
    `,
    [id, userId],
  );

  return result.rowCount > 0;
}