/**
 * Sends job match notifications via Telegram Bot API.
 */
export async function sendNotification(match, groupName) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('  ⚠ Telegram not configured, skipping notification');
    return false;
  }

  const title = String(match?.title || 'Untitled Job');
  const score = match?.match_score || 0;
  const url = match?.post_url || '';
  const group = String(groupName || 'Unknown Group');

  const scoreEmoji = score >= 80 ? '🔥' : score >= 60 ? '✅' : '💡';
  const actionLabel = score >= 80 ? 'Apply Now' : score >= 60 ? 'Worth Checking' : 'Maybe';

  const text = [
    `${scoreEmoji} <b>New SMM/VA Gig Matched!</b>`,
    ``,
    `📌 <b>${escapeHtml(title)}</b>`,
    `🏢 Group: ${escapeHtml(group)}`,
    `📊 Match Score: <b>${score}%</b>`,
    `🎯 Recommended: <b>${actionLabel}</b>`,
    ``,
    url ? `🔗 <a href="${url}">View Post</a>` : '',
    ``,
    `<i>Detected by JobHunter AI</i>`,
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`  ❌ Telegram error: ${JSON.stringify(data)}`);
      return false;
    }

    console.log(`  📱 Notification sent for: ${title.substring(0, 60)}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Notification error: ${err.message}`);
    return false;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
