// Messages from the Copixio notification bot (Telegram Bot API) to a user who linked it in Settings.
const API = () => `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}`;

export async function botCall(method, body) {
  if (!process.env.TG_BOT_TOKEN) return null;
  const r = await fetch(`${API()}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export async function notify(user, text) {
  if (!user?.notifyChatId || !process.env.TG_BOT_TOKEN) return false;
  const j = await botCall("sendMessage", { chat_id: user.notifyChatId, text, parse_mode: "HTML", disable_web_page_preview: true });
  return !!j?.ok;
}

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
