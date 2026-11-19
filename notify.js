// Vercel serverless function: dusre bande ko "pizza offer" jaisa notification bhejta hai.
// Message ka asli text kabhi notification mein nahi jata.
const admin = require("firebase-admin");

const OFFERS = [
  ["🍕 Pizza time!", "Aaj 2 medium pizza sirf ₹299 mein. Jaldi order karo!"],
  ["🍕 Cheese burst craving?", "Aapke liye 40% OFF — sirf aaj raat tak."],
  ["🍔 Bhookh lagi hai?", "Free delivery on your next order 🚀"],
  ["🍕 Your pizza is calling", "Buy 1 Get 1 free — limited time offer."],
  ["🔥 Hot deal", "Farmhouse pizza + Coke @ ₹199. Abhi try karo!"],
  ["🍟 Snack break?", "Garlic bread FREE with every pizza today."],
  ["🍕 Weekend special", "Flat ₹100 OFF on orders above ₹399."]
];

function init() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  try {
    init();
    const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (!m) return res.status(401).end();
    const { uid } = await admin.auth().verifyIdToken(m[1]);

    const allowed = (process.env.ALLOWED_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(uid)) return res.status(403).end();
    const other = allowed.find((u) => u !== uid);
    if (!other) return res.json({ skipped: "no-other" });

    const db = admin.firestore();
    const [p, u] = await Promise.all([db.doc(`presence/${other}`).get(), db.doc(`users/${other}`).get()]);
    const pres = p.data() || {};
    if (pres.online && Date.now() - (pres.lastActive || 0) < 35000) return res.json({ skipped: "online" });

    const ud = u.data() || {};
    if (!ud.fcmToken) return res.json({ skipped: "no-token" });
    if (Date.now() - (ud.lastNotified || 0) < 60000) return res.json({ skipped: "throttled" }); // 1 min mein ek hi

    const [title, body] = OFFERS[Math.floor(Math.random() * OFFERS.length)];
    const origin = "https://" + req.headers.host;
    await admin.messaging().send({
      token: ud.fcmToken,
      webpush: {
        notification: { title, body, icon: origin + "/icons/pizza-192.png", badge: origin + "/icons/badge-96.png", tag: "offer", renotify: true },
        fcmOptions: { link: origin + "/" }
      }
    });
    await u.ref.set({ lastNotified: Date.now() }, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "failed" });
  }
};
