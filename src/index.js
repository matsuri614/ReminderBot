import {
  ApplicationCommandOptionType,
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import dotenv from "dotenv";
import express from "express";

import {
  createReminder,
  deleteReminder,
  getDueReminders,
  getUserReminders,
  initializeDatabase,
  markReminderAsSent,
} from "./db.js";

dotenv.config();

if (!process.env.DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKENが.envに設定されていません。");
}

/*
 * Render用Webサーバー
 */
const app = express();
const port = Number(process.env.PORT) || 3000;

app.get("/", (req, res) => {
  res.send("ReminderBot is running!");
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Webサーバーがポート${port}で起動しました`);
});

/*
 * Discord Bot
 */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  await initializeDatabase();

  await readyClient.application.commands.set([
    {
      name: "help",
      description: "ReminderBotの使い方を表示します",
    },
    {
      name: "remind",
      description: "指定した分数後にリマインドします",
      options: [
        {
          name: "content",
          description: "リマインドする内容",
          type: ApplicationCommandOptionType.String,
          required: true,
        },
        {
          name: "minutes",
          description: "何分後に通知するか",
          type: ApplicationCommandOptionType.Integer,
          required: true,
          min_value: 1,
          max_value: 10080,
        },
      ],
    },
    {
      name: "list",
      description: "登録中のリマインダーを一覧表示します",
    },
    {
      name: "delete",
      description: "登録中のリマインダーを削除します",
      options: [
        {
          name: "id",
          description: "削除するリマインダーの番号",
          type: ApplicationCommandOptionType.Integer,
          required: true,
          min_value: 1,
        },
      ],
    },
  ]);

  console.log(`${readyClient.user.tag}としてログインしました`);
  console.log("/help /remind /list /deleteを登録しました");

  // 10秒ごとに期限を迎えたリマインダーを確認する
  setInterval(checkDueReminders, 10_000);
});

async function checkDueReminders() {
  try {
    const reminders = await getDueReminders();

    for (const reminder of reminders) {
      try {
        const channel = await client.channels.fetch(reminder.channel_id);

        if (!channel?.isTextBased()) {
          console.error(`通知先を取得できません: ${reminder.channel_id}`);
          continue;
        }

        await channel.send(
          `⏰ <@${reminder.user_id}> リマインダーです！\n**${reminder.content}**`,
        );

        await markReminderAsSent(reminder.id);
      } catch (error) {
        console.error(
          `リマインダーID ${reminder.id} の送信に失敗しました:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error("リマインダーの確認に失敗しました:", error);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    /*
     * /help
     */
    if (interaction.commandName === "help") {
      await interaction.reply({
        content: [
          "## ReminderBotの使い方",
          "",
          "### `/remind`",
          "指定した分数後に通知します。",
          "",
          "例：",
          "`/remind content:レポートを提出する minutes:10`",
          "",
          "### `/list`",
          "自分が登録しているリマインダーを表示します。",
          "",
          "### `/delete`",
          "リマインダー番号を指定して削除します。",
          "",
          "例：",
          "`/delete id:3`",
          "",
          "### `/help`",
          "この使い方を表示します。",
        ].join("\n"),
        ephemeral: true,
      });

      return;
    }

    /*
     * /remind
     */
    if (interaction.commandName === "remind") {
      const content = interaction.options.getString("content", true);
      const minutes = interaction.options.getInteger("minutes", true);

      const remindAt = new Date(Date.now() + minutes * 60 * 1000);

      const reminder = await createReminder({
        userId: interaction.user.id,
        channelId: interaction.channelId,
        content,
        remindAt,
      });

      await interaction.reply(
        [
          `✅ ${minutes}分後に「${content}」をリマインドします。`,
          `リマインダー番号：**${reminder.id}**`,
        ].join("\n"),
      );

      return;
    }

    /*
     * /list
     */
    if (interaction.commandName === "list") {
      const reminders = await getUserReminders(interaction.user.id);

      if (reminders.length === 0) {
        await interaction.reply({
          content: "現在登録されているリマインダーはありません。",
          ephemeral: true,
        });

        return;
      }

      const lines = reminders.map((reminder) => {
        const unixTime = Math.floor(
          new Date(reminder.remind_at).getTime() / 1000,
        );

        return [
          `**ID：${reminder.id}**`,
          `内容：${reminder.content}`,
          `通知予定：<t:${unixTime}:F>（<t:${unixTime}:R>）`,
        ].join("\n");
      });

      await interaction.reply({
        content: `## 登録中のリマインダー\n\n${lines.join("\n\n")}`,
        ephemeral: true,
      });

      return;
    }

    /*
     * /delete
     */
    if (interaction.commandName === "delete") {
      const id = interaction.options.getInteger("id", true);

      const deleted = await deleteReminder(id, interaction.user.id);

      if (!deleted) {
        await interaction.reply({
          content:
            "指定されたリマインダーが見つからないか、すでに通知済みです。",
          ephemeral: true,
        });

        return;
      }

      await interaction.reply({
        content: `🗑️ リマインダーID「${id}」を削除しました。`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(error);

    const errorMessage =
      "処理中にエラーが発生しました。しばらくしてからもう一度お試しください。";

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: errorMessage,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: errorMessage,
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);