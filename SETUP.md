# 🧮 Calculator (Secret Chat): Setup Guide

Ye app bahar se ek normal calculator dikhta hai. Calculator mein apna PIN type karke **=** dabao, tab chat khulti hai.
Setup ek baar karna hai, isme lagbhag 20–30 minute lagenge. Sab kuch free hai.

---

## Step 1: Firebase project banao
1. https://console.firebase.google.com par jao, phir **Add project** dabao. Naam kuch normal rakho, jaise `calc-tools`. Google Analytics ki zarurat nahi hai.
2. Left menu mein **Build → Authentication → Get started**. Phir **Email/Password** ko Enable karo.
3. **Users** tab mein **Add user** dabao aur **2 users** banao (ek aapka, ek dusre bande ka), dono ke liye email aur password daalo.
   - Har user ka **User UID** copy karke kahin note kar lo.
4. **Build → Firestore Database → Create database** dabao. Location `asia-south1 (Mumbai)` chuno, mode **Production** rakho.
5. Firestore ke **Rules** tab mein `firestore.rules` file ka content paste karo, `UID_PERSON_1` aur `UID_PERSON_2` ki jagah dono UIDs daalo, phir **Publish** dabao.

## Step 2: `config.js` bharo
1. Firebase Console mein ⚙️ **Project settings → General → Your apps** mein Web icon `</>` dabao. App ka naam kuch bhi rakho, phir **Register** dabao.
2. Jo `firebaseConfig` dikhega, uski values `config.js` ke andar `firebase: { ... }` mein copy karo.
3. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair** dabao. Jo key aaye, use `config.js` mein `vapidKey` mein daalo.

## Step 3: Notification ke liye service account
1. **Project settings → Service accounts → Generate new private key** dabao. Ek JSON file download hogi.
2. ⚠️ Is file ko kisi ko mat dena aur GitHub par mat daalna.

## Step 4: Vercel par deploy karo
1. Ye poora folder GitHub par ek **Private** repo mein upload karo (service account JSON file **nahi** daalni).
2. https://vercel.com par GitHub se login karo, phir **Add New → Project** mein apni repo import karo.
3. Project ka naam normal rakho, jaise `calc-tools`, kyunki URL isi naam se banega.
4. **Environment Variables** mein ye do daalo:
   - `FIREBASE_SERVICE_ACCOUNT` = download hui JSON file ka **poora content** (ek hi line mein paste chalega)
   - `ALLOWED_UIDS` = `UID1,UID2` (dono UIDs, comma lagakar)
5. **Deploy** dabao. Aapko `https://calc-tools-xxxx.vercel.app` jaisa link milega.

> Bina GitHub ke bhi deploy ho sakta hai: computer par `npm i -g vercel` chalao, phir is folder mein `vercel` command chalao, aur env variables Vercel dashboard mein daal do.

## Step 5: Dono phone par install karo
- **Android (Chrome):** link kholo, phir ⋮ menu se **Add to Home screen / Install app** chuno. Home screen par "Calculator" naam ka icon aa jayega.
- **iPhone (Safari):** link kholo, phir Share button se **Add to Home Screen** chuno. iPhone par notifications **sirf** isi tarah install karne par aate hain.
- Install hone ke baad **Home Screen wale icon se** app kholo. Pehli baar Setup screen aayegi:
  - Email/Password: Step 1 mein jo user banaya tha
  - **Secret key: dono phone mein bilkul same honi chahiye** (ye milkar decide karo, aur ise kabhi chat ke andar mat bhejna)
  - Unlock PIN: sirf aapko pata hona chahiye
  - Decoy PIN (optional): koi zabardasti app khulwaye toh ye PIN daalna, isse khali nakli chat khulegi
- Chat kholne ke baad ⋮ menu mein **🔔 Notifications on karo** dabao.

---

## Features
| Feature | Kaise kaam karta hai |
|---|---|
| 🧮 Calculator disguise | Calculator poori tarah kaam karta hai. PIN + `=` dabane par chat khulti hai |
| 🔒 Auto-lock | Screen band ho, app switch karo, ya 3 minute kuch na karo, toh chat turant lock ho jati hai |
| 🎭 Decoy PIN | Ek doosra PIN jisse khali chat khulti hai |
| 🚨 Panic | Header par double-tap karo, phone hilao (shake), ya menu se Panic dabao. Isse Google khul jayega |
| 🔐 End-to-end encryption | AES-256. Server (Firebase) par sirf ulta-pulta encrypted text save hota hai |
| ⏱ Disappearing messages | Padhne ke 1 minute baad, 1 ghante baad, ya 24 ghante baad delete |
| 1️⃣ View-once photo | Ek baar dekhne ke baad photo delete ho jati hai |
| 🗑️ Delete | Apne message par long-press karke delete karo, ya menu se poori chat dono taraf se delete karo |
| 🍕 Fake notifications | "2 pizza ₹299 mein" jaise offers dikhte hain. Asli message kabhi notification mein nahi aata |
| 🟢 Status | online, typing…, last seen, ✓ / ✓✓ (seen) |
| 📵 Phone par kuch save nahi | Messages sirf memory mein rehte hain. Lock karte hi sab saaf ho jata hai |

## ⚠️ Website ki kuch limits (ye kisi bhi website ke saath hoti hain)
- **Screenshot** ko website block nahi kar sakti.
- Android ke **Recent apps** mein kabhi-kabhi lock hone se pehle ki ek jhalak dikh sakti hai.
- **Browser history** mein link aa sakta hai, isliye hamesha Home Screen wale icon se hi kholo.
- Notification par app ka naam "Calculator" ya site ka naam dikh sakta hai. Andar ka text pizza offer wala hi hoga.
- Agar **Secret key** bhool gaye, toh purane messages kabhi nahi khulenge (ye encryption ka hi hissa hai).
