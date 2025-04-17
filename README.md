

# 🧠 Turkish Taboo Telegram Bot

This project is a multiplayer Turkish *Taboo* game bot for Telegram, powered by Google Gemini AI, Firebase Functions, and Firestore.
It generates creative taboo words with AI and manages the game flow interactively via Telegram buttons.

---

## 🚀 Features

- Generates random Turkish words using Gemini 2.0 Flash
- Automatically creates a list of forbidden (taboo) words
- Real-time multiplayer support
- Interactive inline buttons for gameplay
- Prevents word repetition with Firestore checks
- Supports commands: `/oyun`, `/iptal`, `/kelimever`, `/tur`, `/puan`, `/bitir`

---

## 🛠️ Tech Stack

- Node.js
- Firebase Functions v2
- Firestore
- Google Generative AI (Gemini)
- Telegram Bot API
- Axios

---

## 🔧 Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Add your `TELEGRAM_TOKEN` via Firebase Secret Manager.

3. Configure your Firebase and Telegram bot settings.

4. Deploy the function:
   ```bash
   firebase deploy --only functions
   ```

---

## 📌 Notes

- AI ensures diverse and balanced word generation.
- Previously used words are stored in Firestore to avoid repetition.
- Designed to work inside Telegram groups.

---

## 👤 Developed by

[Gökdeniz YILMAZ]

---
