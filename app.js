import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

const C = self.APP_CONFIG || { firebase: {} };
const CONFIGURED = !!C.firebase.apiKey;
const app = CONFIGURED ? initializeApp(C.firebase) : null;
const auth = CONFIGURED ? getAuth(app) : null;
const db = CONFIGURED ? getFirestore(app) : null; // memory cache only — phone par kuch save nahi hota

const $ = (id) => document.getElementById(id);
const LS_KEY = "calc_prefs_v1";
const SHAKE_KEY = "calc_motion_v1";
const CHAT_SALT = new TextEncoder().encode("secret-chat-v1-shared-salt");
const AUTO_LOCK_MS = 3 * 60 * 1000;

/* ======================= crypto ======================= */
const enc = new TextEncoder(), dec = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
function b64(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2Base(pass) {
  return crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey", "deriveBits"]);
}
async function deriveKey(pass, salt) {
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    await pbkdf2Base(pass), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function hashPin(pin, salt) {
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, await pbkdf2Base(pin), 256);
  return b64(bits);
}
async function encryptJSON(key, obj) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptJSON(key, box) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}

/* ======================= helpers ======================= */
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } };
function show(id) {
  for (const s of ["calc", "setup", "chat"]) $(s).classList.toggle("hidden", s !== id);
}
let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 2800);
}
const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// file picker / permission popups ke time auto-lock na ho
let suppressLock = false, suppressT;
function holdLock(ms = 0) {
  suppressLock = true; clearTimeout(suppressT);
  if (ms) suppressT = setTimeout(() => (suppressLock = false), ms);
}
function releaseLock(delay = 800) { clearTimeout(suppressT); suppressT = setTimeout(() => (suppressLock = false), delay); }

/* ======================= calculator ======================= */
let expr = "";
const OPS = "+-×÷";
function renderCalc() {
  $("calcOut").textContent = expr || "0";
  const out = $("calcOut"); out.scrollLeft = out.scrollWidth;
}
function lastNumber() { const m = expr.match(/(\d*\.?\d*)$/); return m ? m[1] : ""; }
function evaluate(s) {
  s = s.replace(/[+\-×÷.]+$/, "");
  if (!s) return null;
  const toks = s.match(/\d*\.?\d+|\d+\.|[+\-×÷]/g);
  if (!toks) return null;
  const nums = [], ops = [];
  let i = 0, sign = 1;
  if (toks[0] === "-") { sign = -1; i = 1; }
  nums.push(sign * parseFloat(toks[i++]));
  while (i < toks.length) { ops.push(toks[i++]); nums.push(parseFloat(toks[i++])); }
  // × ÷ pehle
  for (let j = 0; j < ops.length;) {
    if (ops[j] === "×" || ops[j] === "÷") {
      const r = ops[j] === "×" ? nums[j] * nums[j + 1] : nums[j] / nums[j + 1];
      nums.splice(j, 2, r); ops.splice(j, 1);
    } else j++;
  }
  let r = nums[0];
  for (let j = 0; j < ops.length; j++) r = ops[j] === "+" ? r + nums[j + 1] : r - nums[j + 1];
  return r;
}
function fmt(n) {
  if (!isFinite(n)) return "Error";
  return String(parseFloat(n.toPrecision(12)));
}
async function calcPress(k) {
  if (expr === "Error") expr = "";
  if (k === "C") { expr = ""; $("calcPrev").textContent = ""; }
  else if (k === "⌫") expr = expr.slice(0, -1);
  else if (k === "=") return equals();
  else if (OPS.includes(k)) {
    if (!expr) { if (k === "-") expr = "-"; }
    else if (OPS.includes(expr.slice(-1))) expr = expr.length === 1 ? expr : expr.slice(0, -1) + k;
    else expr += k;
  } else if (k === "%") {
    const n = lastNumber();
    if (n) expr = expr.slice(0, -n.length) + fmt(parseFloat(n) / 100);
  } else if (k === ".") {
    const n = lastNumber();
    if (!n.includes(".")) expr += n ? "." : "0.";
  } else {
    if (expr.length < 24) expr += k;
  }
  renderCalc();
}
async function equals() {
  const raw = expr;
  if (/^\d{4,8}$/.test(raw) && (await tryUnlock(raw))) { expr = ""; $("calcPrev").textContent = ""; renderCalc(); return; }
  const v = evaluate(raw);
  if (v === null) return;
  $("calcPrev").textContent = raw + " =";
  expr = fmt(v);
  renderCalc();
}
$("calcKeys").addEventListener("click", (e) => {
  const k = e.target.closest("button")?.dataset.k;
  if (k) calcPress(k);
});

/* ======================= setup ======================= */
$("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("setupErr"); err.textContent = "";
  const email = $("sEmail").value.trim(), pass = $("sPass").value;
  const secret = $("sSecret").value, pin = $("sPin").value, pin2 = $("sPin2").value, decoy = $("sDecoy").value;
  if (!CONFIGURED) return (err.textContent = "config.js khali hai.");
  if (!/^\d{4,8}$/.test(pin)) return (err.textContent = "PIN 4–8 digits ka hona chahiye.");
  if (pin !== pin2) return (err.textContent = "Dono PIN match nahi kar rahe.");
  if (decoy && (!/^\d{4,8}$/.test(decoy) || decoy === pin)) return (err.textContent = "Decoy PIN alag aur 4–8 digits ka ho.");
  if (secret.length < 8) return (err.textContent = "Secret key kam se kam 8 characters ki ho.");
  $("setupBtn").disabled = true; $("setupBtn").textContent = "Saving…";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    const salt = rand(16);
    const prefs = { salt: b64(salt), box: await encryptJSON(await deriveKey(pin, salt), { secret }) };
    if (decoy) { const ds = rand(16); prefs.decoy = { salt: b64(ds), hash: await hashPin(decoy, ds) }; }
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    $("setupForm").reset();
    expr = ""; renderCalc(); show("calc");
    toast("Setup ho gaya. Ab PIN + = se chat kholo.");
  } catch (ex) {
    err.textContent = "Login fail: " + (ex.code || ex.message);
  } finally {
    $("setupBtn").disabled = false; $("setupBtn").textContent = "Save";
  }
});

/* ======================= unlock / lock ======================= */
let mode = null;          // 'real' | 'decoy' | null
let chatKey = null, me = null;
let unsubs = [], timers = [];
let msgs = [], presence = {}, disappear = "off";
const plainCache = new Map();
let lastActivity = Date.now();
let onceOpenId = null;

async function tryUnlock(pin) {
  const p = loadPrefs(); if (!p) return false;
  let secret = null;
  try { secret = (await decryptJSON(await deriveKey(pin, unb64(p.salt)), p.box)).secret; } catch { /* galat PIN */ }
  if (secret) { await openChat(secret); return true; }
  if (p.decoy && (await hashPin(pin, unb64(p.decoy.salt))) === p.decoy.hash) { openDecoy(); return true; }
  return false;
}

async function openChat(secret) {
  await auth.authStateReady();
  if (!auth.currentUser) { toast("Login expire ho gaya — setup dobara karo."); localStorage.removeItem(LS_KEY); show("setup"); return; }
  me = auth.currentUser.uid;
  chatKey = await deriveKey(secret, CHAT_SALT);
  mode = "real"; document.body.classList.remove("decoy");
  lastActivity = Date.now();
  show("chat");
  $("msgs").innerHTML = "";

  unsubs.push(onSnapshot(query(collection(db, "messages"), orderBy("ts"), limit(500)), (snap) => {
    msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMessages();
  }, (e) => toast("Error: " + e.code)));
  unsubs.push(onSnapshot(collection(db, "presence"), (snap) => {
    presence = {}; snap.forEach((d) => (presence[d.id] = d.data())); renderStatus();
  }));
  unsubs.push(onSnapshot(doc(db, "settings", "chat"), (d) => {
    disappear = d.data()?.disappear || "off"; $("disappearSel").value = disappear; renderBanner();
  }));

  heartbeat();
  timers.push(setInterval(heartbeat, 15000));
  timers.push(setInterval(() => { cleanupExpired(); renderMessages(); renderStatus(); }, 5000));
  if ("Notification" in window && Notification.permission === "granted") registerPush(true);
}

function openDecoy() {
  mode = "decoy"; document.body.classList.add("decoy");
  lastActivity = Date.now();
  show("chat");
  $("status").textContent = "";
  $("timerBanner").classList.add("hidden");
  $("msgs").innerHTML = '<div class="empty">No messages yet</div>';
}

function lock() {
  if (!mode) return;
  if (mode === "real" && me) setDoc(doc(db, "presence", me), { online: false, typingUntil: 0 }, { merge: true }).catch(() => {});
  if (onceOpenId) { deleteDoc(doc(db, "messages", onceOpenId)).catch(() => {}); onceOpenId = null; }
  unsubs.forEach((u) => u()); unsubs = [];
  timers.forEach(clearInterval); timers = [];
  chatKey = null; mode = null; msgs = []; presence = {}; plainCache.clear();
  $("msgs").innerHTML = ""; $("input").value = ""; $("status").textContent = "";
  $("viewerImg").src = "";
  for (const id of ["attachSheet", "menuSheet", "viewer"]) $(id).classList.add("hidden");
  document.body.classList.remove("decoy");
  expr = ""; $("calcPrev").textContent = ""; renderCalc();
  show(loadPrefs() ? "calc" : "setup");
}

function panic() {
  lock();
  location.replace("https://www.google.com");
}

// screen band / app switch / tab change → turant lock
document.addEventListener("visibilitychange", () => { if (document.hidden && !suppressLock) lock(); });
window.addEventListener("pagehide", () => lock());
window.addEventListener("blur", () => { if (!suppressLock) lock(); });
window.addEventListener("pageshow", (e) => { if (e.persisted) lock(); });
// kuch der kuch na karo → lock
["pointerdown", "keydown", "touchstart"].forEach((ev) => addEventListener(ev, () => (lastActivity = Date.now()), { passive: true }));
setInterval(() => { if (mode && Date.now() - lastActivity > AUTO_LOCK_MS) lock(); }, 10000);

// shake → panic
let shakeOn = localStorage.getItem(SHAKE_KEY) !== "0";
let lastShake = 0;
window.addEventListener("devicemotion", (e) => {
  if (!mode || !shakeOn) return;
  const a = e.accelerationIncludingGravity; if (!a) return;
  const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  if (g > 28) { const now = Date.now(); if (now - lastShake < 1200) panic(); lastShake = now; }
});
// header pe double-tap → panic
$("chatTitle").addEventListener("dblclick", panic);

/* ======================= rendering ======================= */
function renderStatus() {
  if (mode !== "real") return;
  const other = Object.entries(presence).find(([id]) => id !== me)?.[1];
  const now = Date.now();
  let s = "";
  if (other) {
    if ((other.typingUntil || 0) > now) s = "typing…";
    else if (other.online && now - (other.lastActive || 0) < 35000) s = "online";
    else if (other.lastActive) s = "last seen " + hhmm(other.lastActive);
  }
  $("status").textContent = s;
}
function renderBanner() {
  const map = { seen: "⏱ Messages padhne ke 1 min baad delete ho jayenge", "1h": "⏱ Messages 1 ghante baad delete ho jayenge", "24h": "⏱ Messages 24 ghante baad delete ho jayenge" };
  const b = $("timerBanner");
  b.textContent = map[disappear] || "";
  b.classList.toggle("hidden", !map[disappear] || mode !== "real");
}

let renderSeq = 0;
async function renderMessages() {
  if (mode !== "real") return;
  const seq = ++renderSeq;
  const now = Date.now();
  const live = msgs.filter((m) => !(m.expireAt && m.expireAt <= now));

  // dusre ke messages ko "seen" mark karo
  if (!document.hidden) {
    for (const m of live) {
      if (m.from !== me && !m.seenAt) {
        const upd = { seenAt: now };
        if (m.disappear === "seen") upd.expireAt = now + 60000;
        m.seenAt = now;
        updateDoc(doc(db, "messages", m.id), upd).catch(() => {});
      }
    }
  }

  // decrypt (cache ke saath)
  for (const m of live) {
    if (plainCache.has(m.id) || (m.once && m.from !== me)) continue;
    try { plainCache.set(m.id, await decryptJSON(chatKey, m)); }
    catch { plainCache.set(m.id, { t: "⚠️ decrypt nahi hua (secret key alag hai?)" }); }
    if (seq !== renderSeq || mode !== "real") return;
  }
  if (seq !== renderSeq || mode !== "real") return;

  const box = $("msgs");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const frag = document.createDocumentFragment();
  if (!live.length) {
    const e = document.createElement("div"); e.className = "empty"; e.textContent = "🔐 End-to-end encrypted. Koi message nahi.";
    frag.appendChild(e);
  }
  for (const m of live) {
    const mine = m.from === me;
    const row = document.createElement("div"); row.className = "msg " + (mine ? "me" : "them"); row.dataset.id = m.id;
    const bub = document.createElement("div"); bub.className = "bubble";
    const p = plainCache.get(m.id);

    if (m.type === "image" && m.once) {
      if (mine) bub.textContent = "1️⃣ View-once photo";
      else {
        const b = document.createElement("button"); b.className = "once-btn"; b.textContent = "1️⃣ Photo kholo (ek baar)";
        b.onclick = () => openOnce(m); bub.appendChild(b);
      }
    } else if (m.type === "image" && p?.img) {
      const img = document.createElement("img"); img.src = p.img; img.onclick = () => openViewer(p.img, "");
      bub.appendChild(img);
    } else {
      bub.textContent = p?.t ?? "";
    }

    const meta = document.createElement("span"); meta.className = "meta";
    let mt = hhmm(m.ts);
    if (m.expireAt || m.disappear === "seen") mt = "⏱ " + mt;
    meta.textContent = mt;
    if (mine) {
      const tick = document.createElement("span");
      tick.textContent = m.seenAt ? " ✓✓" : " ✓"; if (m.seenAt) tick.className = "seen";
      meta.appendChild(tick);
    }
    bub.appendChild(meta);
    row.appendChild(bub);
    frag.appendChild(row);
  }
  box.replaceChildren(frag);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

// apna message long-press → delete (dono taraf)
$("msgs").addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".msg.me"); if (!row || mode !== "real") return;
  e.preventDefault();
  holdLock();
  const ok = confirm("Ye message dono taraf se delete karein?");
  releaseLock();
  if (ok) deleteDoc(doc(db, "messages", row.dataset.id)).catch(() => {});
});

function cleanupExpired() {
  const now = Date.now();
  for (const m of msgs) if (m.expireAt && m.expireAt <= now) deleteDoc(doc(db, "messages", m.id)).catch(() => {});
}

/* ======================= viewer / view-once ======================= */
function openViewer(src, note) {
  $("viewerImg").src = src; $("viewerNote").textContent = note; $("viewer").classList.remove("hidden");
}
async function openOnce(m) {
  try {
    const p = await decryptJSON(chatKey, m);
    onceOpenId = m.id;
    openViewer(p.img, "Band karte hi photo hamesha ke liye delete ho jayegi");
  } catch { toast("Photo nahi khul payi"); }
}
$("viewerClose").onclick = () => {
  $("viewer").classList.add("hidden"); $("viewerImg").src = "";
  if (onceOpenId) { deleteDoc(doc(db, "messages", onceOpenId)).catch(() => {}); onceOpenId = null; }
};

/* ======================= sending ======================= */
function expiryFor(now) {
  if (disappear === "1h") return now + 3600e3;
  if (disappear === "24h") return now + 86400e3;
  return null;
}
async function sendPayload(payload, extra = {}) {
  if (mode === "decoy") {
    const row = document.createElement("div"); row.className = "msg me";
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = payload.t || "📷";
    row.appendChild(b); $("msgs").querySelector(".empty")?.remove(); $("msgs").appendChild(row);
    return;
  }
  if (mode !== "real") return;
  const now = Date.now();
  const box = await encryptJSON(chatKey, payload);
  if (box.ct.length > 950000) { toast("Photo bahut badi hai"); return; }
  await addDoc(collection(db, "messages"), {
    from: me, type: "text", ...extra, iv: box.iv, ct: box.ct,
    ts: now, seenAt: null, disappear, expireAt: expiryFor(now)
  });
  notifyOther();
}
async function sendText() {
  const el = $("input"); const t = el.value.trim();
  if (!t) return;
  el.value = ""; autoGrow();
  try { await sendPayload({ t }); } catch (e) { toast("Send fail: " + (e.code || e.message)); el.value = t; }
}
$("sendBtn").addEventListener("click", sendText);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); sendText(); }
});
function autoGrow() { const el = $("input"); el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }
let lastTypingPing = 0;
$("input").addEventListener("input", () => {
  autoGrow();
  if (mode !== "real") return;
  const now = Date.now();
  if (now - lastTypingPing > 2500) {
    lastTypingPing = now;
    setDoc(doc(db, "presence", me), { typingUntil: now + 4000 }, { merge: true }).catch(() => {});
  }
});

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  let max = 1280, q = 0.7, out = "";
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    out = c.toDataURL("image/jpeg", q);
    if (out.length < 650000) break;
    max *= 0.8; q = Math.max(0.4, q - 0.1);
  }
  return out;
}
async function handleFile(input, once) {
  releaseLock();
  const f = input.files[0]; input.value = "";
  if (!f || !mode) return;
  try {
    toast("Photo bhej rahe hain…");
    const img = await compressImage(f);
    await sendPayload({ img }, { type: "image", once });
  } catch (e) { toast("Photo fail: " + (e.code || e.message)); }
}
$("filePhoto").addEventListener("change", (e) => handleFile(e.target, false));
$("fileOnce").addEventListener("change", (e) => handleFile(e.target, true));
// agar picker cancel ho jaye
window.addEventListener("focus", () => { if (suppressLock) releaseLock(1500); });

$("attachBtn").onclick = () => $("attachSheet").classList.remove("hidden");
$("attachSheet").addEventListener("click", (e) => {
  const a = e.target.closest("button")?.dataset.act; if (!a) return;
  $("attachSheet").classList.add("hidden");
  if (a === "photo" || a === "once") {
    if (mode === "decoy") return toast("Photo nahi bhej sakte");
    holdLock(60000);
    $(a === "photo" ? "filePhoto" : "fileOnce").click();
  }
});

/* ======================= presence / push ======================= */
function heartbeat() {
  if (mode !== "real") return;
  setDoc(doc(db, "presence", me), { online: true, lastActive: Date.now() }, { merge: true }).catch(() => {});
}
async function notifyOther() {
  try {
    const t = await auth.currentUser.getIdToken();
    fetch("/api/notify", { method: "POST", headers: { Authorization: "Bearer " + t } }).catch(() => {});
  } catch {}
}
async function registerPush(silent) {
  try {
    if (!(await isSupported())) { if (!silent) toast("Is browser mein notifications nahi chalenge. iPhone par pehle Home Screen par add karo."); return; }
    if (!C.vapidKey) { if (!silent) toast("config.js mein vapidKey nahi hai"); return; }
    if (!silent) { holdLock(); const perm = await Notification.requestPermission(); releaseLock(); if (perm !== "granted") return toast("Permission nahi mili"); }
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: C.vapidKey, serviceWorkerRegistration: reg });
    if (token && mode === "real") await setDoc(doc(db, "users", me), { fcmToken: token, updated: Date.now() }, { merge: true });
    if (!silent) toast("Notifications on ✅ (pizza offer jaise dikhenge 🍕)");
  } catch (e) { releaseLock(); if (!silent) toast("Notification error: " + (e.code || e.message)); }
}

/* ======================= menu ======================= */
function renderShake() { $("shakeState").textContent = shakeOn ? "ON" : "OFF"; }
renderShake();
$("menuBtn").onclick = () => $("menuSheet").classList.remove("hidden");
$("lockBtn").onclick = () => lock();
$("disappearSel").addEventListener("change", (e) => {
  if (mode !== "real") return;
  setDoc(doc(db, "settings", "chat"), { disappear: e.target.value }, { merge: true }).catch(() => {});
});
$("menuSheet").addEventListener("click", async (e) => {
  const a = e.target.closest("button")?.dataset.act; if (!a) return;
  if (a === "close") return $("menuSheet").classList.add("hidden");
  if (a === "panic") return panic();
  if (a === "notif") { $("menuSheet").classList.add("hidden"); return registerPush(false); }
  if (a === "shake") {
    shakeOn = !shakeOn; localStorage.setItem(SHAKE_KEY, shakeOn ? "1" : "0"); renderShake();
    if (shakeOn && typeof DeviceMotionEvent?.requestPermission === "function") {
      holdLock(); try { await DeviceMotionEvent.requestPermission(); } catch {} releaseLock();
    }
    return;
  }
  if (a === "wipe") {
    holdLock(); const ok = confirm("Poori chat dono phone se hamesha ke liye delete ho jayegi. Pakka?"); releaseLock();
    if (!ok) return;
    $("menuSheet").classList.add("hidden");
    const snap = await getDocs(collection(db, "messages"));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db); snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit();
    }
    plainCache.clear(); toast("Sab delete ho gaya");
  }
  if (a === "reset") {
    holdLock(); const ok = confirm("Is phone se setup aur login hata dein? (Chat server par rahegi)"); releaseLock();
    if (!ok) return;
    localStorage.removeItem(LS_KEY);
    try { await signOut(auth); } catch {}
    lock(); show("setup");
  }
});

/* ======================= start ======================= */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
$("cfgWarn").classList.toggle("hidden", CONFIGURED);
renderCalc();
show(loadPrefs() ? "calc" : "setup");
