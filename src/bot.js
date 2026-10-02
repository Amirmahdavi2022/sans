// Bot side of Sans: /start, the channel gate, deep links and quick text search.

import { bot, isMember, channelLink } from './telegram.js';
import * as T from './tmdb.js';

const TXT = {
  fa: {
    welcome: (name) => `🎬 سلام ${name || 'رفیق'}، به <b>سانس</b> خوش اومدی!\n\nاینجا می‌تونی ببینی الان چی داغه، امشب چی ببینی، و لیست فیلم و سریال‌هات رو داشته باشی.\n\nاسم هر فیلم یا سریالی رو هم برام بفرستی، پیداش می‌کنم 🍿`,
    open: '🎬 باز کردن سانس',
    join: (ch) => `برای استفاده از سانس اول باید عضو کانال ${ch} بشی 🙏\nبعد از عضویت، دکمه‌ی «عضو شدم» رو بزن.`,
    joinBtn: '📢 عضویت در کانال',
    joined: '✅ عضو شدم',
    notYet: 'هنوز عضو کانال نشدی 🙂',
    found: 'اینا رو پیدا کردم 👇',
    none: 'چیزی پیدا نکردم 🤔 اسمش رو یه جور دیگه بنویس، یا انگلیسیش رو امتحان کن.',
    openTitle: 'برای دیدن جزئیات بزن 👇',
  },
  en: {
    welcome: (name) => `🎬 Hey ${name || 'there'}, welcome to <b>Sans</b>!\n\nSee what's hot right now, get a pick for tonight, and keep your own watchlist.\n\nSend me the name of any movie or show and I'll find it 🍿`,
    open: '🎬 Open Sans',
    join: (ch) => `To use Sans, please join ${ch} first 🙏\nThen tap "I joined".`,
    joinBtn: '📢 Join the channel',
    joined: '✅ I joined',
    notYet: "You haven't joined yet 🙂",
    found: 'Here is what I found 👇',
    none: "Couldn't find that 🤔 Try another spelling.",
    openTitle: 'Tap to open 👇',
  },
};

const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function appUrl(env, hash) {
  return `${env.PUBLIC_URL}/${hash ? `#${hash}` : ''}`;
}

async function userLang(env, from) {
  const row = await env.DB.prepare('SELECT lang FROM users WHERE id = ?1').bind(from.id).first().catch(() => null);
  if (row && row.lang) return row.lang;
  // Most of the audience reads Persian even with Telegram set to English, so
  // Persian is the default until they switch inside the app.
  return 'fa';
}

async function remember(env, from) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username, lang, created_at, last_seen) VALUES (?1, ?2, ?3, NULL, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET first_name = ?2, username = ?3, last_seen = ?4`,
  ).bind(from.id, from.first_name || '', from.username || '', now).run().catch(() => {});
}

function joinMarkup(env, t, payload) {
  return {
    inline_keyboard: [
      [{ text: t.joinBtn, url: channelLink(env) }],
      [{ text: t.joined, callback_data: `chk:${payload || ''}`.slice(0, 64) }],
    ],
  };
}

function payloadHash(payload) {
  const m = String(payload || '').match(/^(movie|tv)_(\d{1,9})$/);
  return m ? `/t/${m[1]}/${m[2]}` : '';
}

async function sendWelcome(env, chatId, from, t, payload) {
  const hash = payloadHash(payload);
  await bot(env, 'sendMessage', {
    chat_id: chatId,
    text: hash ? t.openTitle : t.welcome(esc(from.first_name)),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: t.open, web_app: { url: appUrl(env, hash) } }]] },
  });
}

export async function handleUpdate(update, env, ctx) {
  if (update.callback_query) {
    const q = update.callback_query;
    const lang = await userLang(env, q.from);
    const t = TXT[lang];
    if (String(q.data || '').startsWith('chk:')) {
      const ok = await isMember(env, q.from.id, ctx);
      if (ok === false) {
        await bot(env, 'answerCallbackQuery', { callback_query_id: q.id, text: t.notYet, show_alert: true });
        return;
      }
      await bot(env, 'answerCallbackQuery', { callback_query_id: q.id });
      if (q.message) await bot(env, 'deleteMessage', { chat_id: q.message.chat.id, message_id: q.message.message_id });
      await sendWelcome(env, q.from.id, q.from, t, String(q.data).slice(4));
    }
    return;
  }

  const msg = update.message;
  if (!msg || !msg.from || !msg.chat || msg.chat.type !== 'private') return;
  await remember(env, msg.from);
  const lang = await userLang(env, msg.from);
  const t = TXT[lang];
  const text = String(msg.text || '').trim();

  const member = await isMember(env, msg.from.id, ctx);
  const start = text.match(/^\/start(?:\s+(\S+))?/);
  if (member === false) {
    await bot(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: t.join(env.CHANNEL),
      reply_markup: joinMarkup(env, t, start ? start[1] : ''),
    });
    return;
  }

  if (start || !text) {
    await sendWelcome(env, msg.chat.id, msg.from, t, start ? start[1] : '');
    return;
  }
  if (text.startsWith('/')) {
    await sendWelcome(env, msg.chat.id, msg.from, t, '');
    return;
  }

  // Plain text: quick search, results as Mini App buttons.
  const res = await T.search(env, text, lang).catch(() => ({ items: [] }));
  const items = res.items.slice(0, 6);
  if (!items.length) {
    await bot(env, 'sendMessage', { chat_id: msg.chat.id, text: t.none });
    return;
  }
  await bot(env, 'sendMessage', {
    chat_id: msg.chat.id,
    text: t.found,
    reply_markup: {
      inline_keyboard: items.map((c) => [{
        text: `${c.type === 'tv' ? '📺' : '🎬'} ${c.title}${c.year ? ` (${c.year})` : ''}${c.rating ? ` ⭐${c.rating}` : ''}`.slice(0, 60),
        web_app: { url: appUrl(env, `/t/${c.type}/${c.id}`) },
      }]),
    },
  });
}
