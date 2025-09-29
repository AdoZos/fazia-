import admin from 'firebase-admin';

let app;
if (!admin.apps.length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  app = admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

export async function handler(event) {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' };

  const auth = event.headers.authorization || '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!idToken)
    return json(401, { error: 'Missing auth token' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return json(401, { error: 'Invalid auth token' });
  }

  const { key } = JSON.parse(event.body || '{}');
  if (!key) return json(400, { error: 'Key required' });

  const keyRef = db.collection('keys').doc(key);
  const subRef = db.doc(`users/${uid}/subscription/current`);

  try {
    await db.runTransaction(async tx => {
      const keySnap = await tx.get(keyRef);
      if (!keySnap.exists) throw new Error('Key not found');
      const kd = keySnap.data();
      if (kd.revoked) throw new Error('Key revoked');
      if (kd.usedBy && kd.usedBy !== uid) throw new Error('Key already used');

      let until;
      if (kd.type === 'perm') {
        until = new Date('2999-01-01');
      } else {
        until = new Date();
        until.setDate(until.getDate() + (kd.durationDays || 30));
      }

      tx.set(subRef, {
        type: kd.type,
        validUntil: admin.firestore.Timestamp.fromDate(until),
        sourceKey: key,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(keyRef, {
        usedBy: uid,
        usedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return json(200, { ok: true });
  } catch (e) {
    return json(400, { error: e.message || 'Redeem failed' });
  }
}

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
