import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testNotification() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env.local');
    process.exit(1);
  }

  console.log('📱 Sending test notification...');

  const text = [
    '🧪 <b>JobHunter AI — Test Notification</b>',
    '',
    'If you see this, the Telegram notification pipeline is working!',
    '',
    '📊 Bot: @MakiSyncBot',
    '🔧 Status: Connected',
    '',
    '<i>Sent from jobhunter-ai service</i>',
  ].join('\n');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();
  if (data.ok) {
    console.log('✅ Test notification sent successfully!');
    console.log(`   Chat ID: ${chatId}`);
  } else {
    console.error('❌ Failed:', JSON.stringify(data));
  }
}

testNotification();
