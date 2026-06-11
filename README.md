# Event Commitment Display

Live commitment/pledge display for the event with 138 members.
- 🏛️ Beis Hamedrash backdrop
- ⭕ Two progress circles (Commitments + Fundraising)
- 🎉 5-second popup celebrations on every pledge
- 📜 Side bars showing pledged members in gold
- 🎛️ Multi-admin support (3-4 people can use admin panel simultaneously)

## URLs after deploy
- **Big display screen** → `https://YOUR-APP.onrender.com/`
- **Admin control** → `https://YOUR-APP.onrender.com/admin`
- **Default password** → `admin2026` (change in `server.js` line 17 if needed)

## Pre-loaded data
- 138 members already loaded with real names (alphabetical)
- Pledge (Commitment) goal: $2,000,000
- Fundraising (Raise) goal: $500,000
- All settings persist between restarts via `data.json`

## Local development
```bash
npm install
npm start
```
Runs on http://localhost:3000
