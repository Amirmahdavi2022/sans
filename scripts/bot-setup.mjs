// Points the bot at the Worker and sets its menu button, commands and texts.
const BASE = process.env.PUBLIC_URL;
const TOKEN = process.env.BOT_TOKEN;
const SECRET = process.env.WEBHOOK_SECRET;

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  console.log(`${j.ok ? 'ok  ' : 'FAIL'} ${method}${j.ok ? '' : ' · ' + j.description}`);
  return j;
}

await tg('setWebhook', { url: `${BASE}/tg/webhook`, secret_token: SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'سانس', web_app: { url: `${BASE}/` } } });
await tg('setMyCommands', { commands: [{ command: 'start', description: 'باز کردن سانس 🎬' }] });
await tg('setMyCommands', { commands: [{ command: 'start', description: 'Open Sans 🎬' }], language_code: 'en' });
await tg('setMyShortDescription', { short_description: 'راهنمای فیلم و سریال: الان چی داغه، امشب چی ببینم، لیست خودت 🍿' });
await tg('setMyShortDescription', { short_description: "Movie & series guide: what's hot, what to watch tonight, your own list 🍿", language_code: 'en' });
await tg('setMyDescription', { description: '🎬 سانس راهنمای فیلم و سریاله.\n\nترندهای روز، پیشنهاد امشب با سه تا سؤال، جزئیات و بازیگرها، لیست «می‌خوام ببینم» و خبر دادن قسمت جدید سریال‌ها.\n\nاسم هر فیلمی رو هم بفرستی پیداش می‌کنه.' });
await tg('setMyDescription', { description: "🎬 Sans is a movie & series guide.\n\nToday's trends, a pick for tonight in three questions, details and cast, a watchlist, and alerts for new episodes.\n\nSend any title and it will find it.", language_code: 'en' });
