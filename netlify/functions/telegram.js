import admin from 'firebase-admin';

let app;
if (!admin.apps.length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  app = admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID  = process.env.TELEGRAM_ADMIN_ID; // your Telegram numeric user id
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'OK' };

  const update = JSON.parse(event.body || '{}');
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return { statusCode: 200, body: 'OK' };

  const chatId = String(msg.chat.id);
  const fromId = String(msg.from.id);
  const text = msg.text.trim();

  if (fromId !== String(ADMIN_ID)) {
    await send(chatId, 'Unauthorized.');
    return ok();
  }

  try {
    if (text.startsWith('/newkey')) {
      const type = text.split(/\s+/)[1];
      let keyType, durationDays;
      if (type === '30d') { keyType='30d'; durationDays=30; }
      else if (type === 'perm') { keyType='perm'; }
      else { await send(chatId, 'Usage: /newkey 30d OR /newkey perm'); return ok(); }

      const key = genKey();
      await db.collection('keys').doc(key).set({
        type: keyType, durationDays, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: ADMIN_ID, revoked: false
      });
      await send(chatId, `✅ Key created:\n${key}`);
      return ok();
    }

    if (text.startsWith('/revoke')) {
      const key = text.split(/\s+/)[1];
      await db.collection('keys').doc(key).set({ revoked: true }, { merge: true });
      await send(chatId, `🛑 Key revoked: ${key}`);
      return ok();
    }

    if (text.startsWith('/listkeys')) {
      const snap = await db.collection('keys').orderBy('createdAt','desc').limit(20).get();
      const lines = [];
      snap.forEach(d=>{
        const v=d.data();
        lines.push(`${d.id} — ${v.type} ${v.revoked?'revoked':(v.usedBy?'used':'unused')}`);
      });
      await send(chatId, lines.join('\n') || 'No keys');
      return ok();
    }

    await send(chatId, 'Commands: /newkey 30d | /newkey perm | /revoke KEY | /listkeys');
    return ok();

  } catch (e) {
    await send(chatId, 'Error: ' + e.message);
    return ok();
  }
}

function ok(){ return { statusCode: 200, body: 'OK' }; }
async function send(chatId, text){
  await fetch(`${API}/sendMessage`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
function genKey(){
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = n => Array.from({length:n},()=> s[Math.floor(Math.random()*s.length)]).join('');
  return `KEY-${part(4)}-${part(4)}-${part(4)}`;
}
