const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const loadConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  const match = fs.readFileSync(ENV_PATH, 'utf8').match(/^\s*BOT_TOKEN\s*=\s*(.+?)\s*$/m);
  if (match) process.env.BOT_TOKEN ??= match[1];
}

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN || TOKEN.includes('ВСТАВЬ')) {
  console.error('Нет токена. Скопируй .env.example в .env и впиши токен от @BotFather.');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

async function api(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const sendText = (chatId, text, keyboard) =>
  api('sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });

const mainMenu = () => ({
  inline_keyboard: [
    [{ text: 'Обо мне', callback_data: 'about' }],
    [{ text: 'Портфолио', callback_data: 'portfolio' }],
    [{ text: 'Связаться', callback_data: 'contacts' }],
  ],
});

const backButton = { text: '« Вернуться в меню', callback_data: 'menu' };

function section(name) {
  const cfg = loadConfig();
  if (name === 'about') {
    return { text: cfg.about, keyboard: { inline_keyboard: [[backButton]] } };
  }
  if (name === 'portfolio') {
    if (!cfg.portfolio.length) {
      return {
        text: 'Портфолио пока пустое. Добавь проекты в config.json.',
        keyboard: { inline_keyboard: [[backButton]] },
      };
    }
    const lines = cfg.portfolio.map((p, i) => `${i + 1}. ${p.title} — ${p.description}`);
    const keyboard = {
      inline_keyboard: [
        ...cfg.portfolio.map((p) => [{ text: p.title, url: p.url }]),
        [backButton],
      ],
    };
    return { text: 'Мои проекты:\n\n' + lines.join('\n'), keyboard };
  }
  if (name === 'contacts') {
    const keyboard = {
      inline_keyboard: [
        ...cfg.contacts.map((c) => [{ text: c.label, url: c.url }]),
        [backButton],
      ],
    };
    return { text: cfg.contacts_text, keyboard };
  }
  return { text: cfg.start_text, keyboard: mainMenu() };
}

const commandSections = { '/start': 'menu', '/about': 'about', '/portfolio': 'portfolio', '/contacts': 'contacts' };

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const command = (msg.text || '').trim().split(/\s|@/)[0];
  const name = commandSections[command];
  if (!name) return sendText(chatId, 'Выбери раздел в меню или нажми /start.', mainMenu());
  const { text, keyboard } = section(name);
  return sendText(chatId, text, keyboard);
}

async function handleCallback(query) {
  await api('answerCallbackQuery', { callback_query_id: query.id });
  const { text, keyboard } = section(query.data);
  try {
    await api('editMessageText', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text,
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
  } catch (err) {
    // повторное нажатие той же кнопки — сообщение уже такое, ничего не делаем
    if (!err.message.includes('message is not modified')) throw err;
  }
}

async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
}

async function main() {
  const me = await api('getMe', {});
  await api('setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню' },
      { command: 'about', description: 'Обо мне' },
      { command: 'portfolio', description: 'Портфолио' },
      { command: 'contacts', description: 'Контакты' },
    ],
  });
  console.log(`Бот @${me.username} запущен. Остановка: Ctrl+C.`);

  let offset = 0;
  for (;;) {
    try {
      const updates = await api('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (err) {
          console.error('Ошибка обработки обновления:', err.message);
        }
      }
    } catch (err) {
      console.error('Ошибка соединения с Telegram:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => {
  console.error('Не удалось запустить бота:', err.message);
  process.exit(1);
});
