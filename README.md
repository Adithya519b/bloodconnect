# 🩸 BloodConnect — Emergency Blood Donor Telegram Bot

**Status:** Step 15 complete (React admin dashboard over the REST API — full core bot workflow done)

> ⚠️ **Prototype disclaimer** — BloodConnect is a student prototype that connects people who
> urgently need blood with registered blood donors. It does **not** verify blood group, donor
> eligibility, availability or medical suitability. Those must be verified by qualified medical
> professionals or blood banks. In a real emergency always contact a hospital, blood bank or
> emergency service first.

---

## Problem statement

During emergencies, finding a matching blood donor nearby is slow and stressful. People have to
call individual donors, check availability, and often cannot estimate how far a donor is.

BloodConnect solves this by:

1. Letting donors register their blood group and current location through Telegram.
2. Letting a person in need broadcast an emergency request for a blood group and radius.
3. Automatically notifying all available matching donors who are inside that radius.
4. Letting the first donor who accepts be connected to the requester.

Telegram is used as the notification channel because it is free, needs no paid API, and is
already installed on most phones.

---

## Tech stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Bot        | Telegram Bot API (direct HTTPS calls)        |
| Backend    | Node.js, Express.js                          |
| Database   | MongoDB (Atlas free tier) + Mongoose         |
| Frontend   | React + Vite *(added in a later step)*        |
| Dev tools  | nodemon, dotenv, Postman                     |

No paid APIs are used. Everything here is free for development and demonstration.

---

## Project structure (current)

```
bloodconnect/
├── server/
│   ├── config/
│   │   └── db.js                 # MongoDB (Atlas) connection
│   ├── bot/
│   │   ├── bot.js                # Polling loop + message routing
│   │   ├── commands.js           # Command list, menu labels, validation helpers
│   │   └── handlers.js           # Command handlers + registration wizard + sessions
│   ├── services/
│   │   ├── telegramService.js    # All Telegram API calls live here
│   │   └── donorService.js       # Saves/updates donors in MongoDB
│   ├── models/
│   │   └── User.js               # Donor schema, GeoJSON point, 2dsphere index
│   ├── controllers/              # (later)
│   ├── routes/                   # (later)
│   ├── utils/                    # (later)
│   ├── server.js                 # Express entry point
│   ├── package.json
│   ├── .env                      # your secrets - never committed
│   └── .env.example              # template that IS committed
├── .gitignore
└── README.md
```

---

## Steps 1–2 — What was implemented earlier

| File                          | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `server/server.js`            | Express app, CORS, JSON parsing, `GET /api/health`, graceful shutdown     |
| `server/config/db.js`         | Connects to MongoDB Atlas using `MONGODB_URI`                            |
| `server/services/telegramService.js` | Single place that talks to the Telegram Bot API               |
| `server/bot/bot.js`           | Long-polling loop and message routing                                    |
| `server/bot/commands.js`      | Command list, menu labels, validation helpers                            |
| `server/bot/handlers.js`      | Command handlers, sessions, registration wizard                          |
| `server/.env`                 | Your bot token and database string (git-ignored)                         |
| `server/.env.example`         | Template showing which variables are needed                              |
| `.gitignore`                  | Blocks `node_modules`, `.env`, `dist`, logs from Git                     |

## Step 3 — Donor registration wizard

Starting `/register` now runs a 4-question conversation:

1. **Name** — typed text, must be 2–50 characters.
2. **Blood group** — tapped from buttons `A+ A- B+ B- O+ O- AB+ AB-`.
3. **Availability** — tapped from 🟢 Available / 🔴 Not Available.
4. **Location** — shared with Telegram's native **📍 Share Location** button (Step 4).

Two important ideas in this step:

- **Session state (`userSessions` Map)** — the bot is stateless: every Telegram message
  arrives separately. To run a multi-step conversation we remember in memory
  (`Map<telegramId, { step, data }>`) which question the user is on and what they answered.
  It resets when the server restarts — acceptable for a prototype.
- **Keyboard switching** — during the wizard the main-menu reply keyboard is *removed*
  (via `{ remove_keyboard: true }`) so typed answers like a name are never confused with a
  menu button tap. The blood-group keyboard appears only while answering that question.
- **Validation** — anything invalid (short name, wrong blood group) re-asks the same
  question instead of saving bad data. `/cancel` (or typing `cancel` / `stop`) exits the
  wizard and saves nothing.

## Step 4 — Location handling (new)

The last wizard question asks for location with Telegram's **native location button**:

- The keyboard button carries `request_location: true`. Telegram then shows its standard
  "Share your location" map dialog — the user taps once and the app sends exact GPS
  coordinates. **Nobody ever types latitude/longitude by hand.**
- Telegram delivers it as a `message.location` object `{ latitude, longitude }`, which the
  bot now routes to a dedicated handler.
- Live/moving location shares are rejected with a hint (we only want a single point).
- The coordinates are stored in the session as `{ latitude, longitude }` and shown in the
  final summary. Converting them to MongoDB **GeoJSON** happens with the model in Step 5.
- If a user sends a location outside any conversation, the bot explains where location is
  used instead of crashing silently.

## Step 5 — MongoDB donor storage (new)

The wizard's last step now **saves the donor to Atlas**:

- **`models/User.js`** — the Mongoose schema: `telegramId` (unique key), `username`, `name`,
  `bloodGroup` (validated against the 8 groups), GeoJSON `location`, `available`, plus
  `createdAt`/`updatedAt` (via `timestamps: true`).
- **GeoJSON format** — MongoDB stores coordinates as
  `{ type: "Point", coordinates: [longitude, latitude] }`. Note the order: **longitude
  first** — the reverse of Telegram/Google Maps. The service converts automatically.
- **`services/donorService.js`** — `upsertDonor()` re-running `/register` **updates** the
  same document instead of creating a duplicate (upsert on `telegramId`).
- **Indexes** — a `2dsphere` index on `location` (makes "donors within X km" queries fast,
  used in Step 9) and a compound `{ bloodGroup, available }` index for the matching filter.
- **Failure paths** — if Atlas is unreachable, the user gets a clear "database not
  connected" message instead of a silent hang or crash; the DB check uses Mongoose's
  connection state before attempting a save.

## Step 6 — Donor profile & availability (new)

`/profile` now shows the saved donor card straight from Atlas:

```
👤 My Donor Profile

Name: Asha
Blood group: O+
Availability: 🟢 Available
Location: ✅ saved (12.9716, 77.5946)

Registered: 26/9/2026
```

with two **inline buttons** attached to the message itself:

- **🔴 Set Not Available / 🟢 Set Available** — flips availability in MongoDB and
  re-renders the same card in place. Unavailable donors will not receive emergency
  notifications (matching filter arrives in Step 9).
- **🔄 Re-register** — restarts the registration wizard to change name/group/location.

New concepts in this step:

- **Inline keyboard** — buttons attached *under a message* (unlike reply keyboards, which
  sit at the bottom of the chat). Tapping one does not send text; it fires a
  `callback_query` with a hidden code like `avail:no`.
- **Callback query** — the button-tap event. Telegram requires the bot to acknowledge it
  within seconds (`answerCallbackQuery`) or the user's app shows an endless spinner.
- **editMessageText** — updates a message the bot already sent, so toggling availability
  refreshes one card instead of spamming new messages.
- **Database round-trip** — every toggle is verified against MongoDB server-side; the
  button is only a convenience, never the source of truth.

A sample test script also exists now: `npm run test:db` verifies connection, upsert,
field storage, geospatial queries and cleanup without Telegram.

## Step 7 — Emergency blood request wizard (new)

🚨 **Emergency Blood Request** (or `/request`) now runs a 4-step wizard:

| Step | Question | Input style |
| ---- | -------- | ----------- |
| 1 | Blood group required | Buttons `A+ … AB-` |
| 2 | Units required | Typed whole number 1–10 |
| 3 | Location where blood is needed | 📍 native Share Location button |
| 4 | Search radius | Buttons `5 / 10 / 20 / 50 KM` |

Then a **confirmation card** (nothing is sent before it):

```
🚨 Confirm Blood Request

Blood Group: O+
Units: 2
Radius: 10 KM
Location: ✅ received (12.9716, 77.5946)
```

with inline buttons **✅ Submit Request** / **❌ Cancel**.

Notes:

- **Validation** — units must be a whole number 1–10; radius only via buttons;
  wrong answers re-ask the same question.
- **Confirmation is a real gate** — Submit is handled server-side: it only works
  while a `request:confirm` session is active, so a stale card from an old chat
  can never submit anything.
- **Step 7 scope** — a submitted request is validated and acknowledged, but not
  yet stored (Step 8: `BloodRequest` model) or broadcast to donors
  (Steps 9–10: matching + notifications). The success message says so explicitly.
- **Cancel safety** — `/cancel` (or ❌) at ANY point answers with
  "Nothing was sent to any donor." — true even after matching exists, because
  cancellation happens before submission.

## Step 8 — BloodRequest model & storage (new)

Tapping ✅ Submit now creates a real document in Atlas:

- **`models/BloodRequest.js`** — `requesterId` (Telegram id), `bloodGroup`,
  `unitsRequired` (1–10), GeoJSON `location`, `radiusKm`, `status`, `matchedDonors`,
  `acceptedDonor`, auto timestamps.
- **Status lifecycle** — `OPEN → DONOR_NOTIFIED → DONOR_FOUND → COMPLETED / CANCELLED`.
  Every state is enforced server-side with a schema enum, never by buttons.
- **Indexes** — `{ requesterId, status }` for "/my requests" and cancellation;
  `{ status, createdAt }` for the future dashboard's recent-requests list.
- **One active request per requester** — submitting while an active request exists is
  rejected with its Request ID and status, so `/status` and `/cancel` stay unambiguous.
- **DB-down path** — if Atlas is unreachable at Submit time, the session is kept alive
  so the user can simply tap ✅ Submit again after the connection returns.

Where your data lives: the connection string has no database name in the path, so
Mongoose uses the default database **`test`** — in Atlas, browse **Cluster0 → test →**
`users` and `bloodrequests`.

## Step 9 — Matching engine (new)

The moment a request is submitted, `services/matchingService.js` finds donors:

1. **`$geoNear`** searches outward from the request location — this is MongoDB's
   geospatial search, powered by the `2dsphere` index from Step 5. Distance is measured
   in **metres** (`radiusKm * 1000`) and results come back nearest-first.
2. The **filter** keeps only donors that are ALL of:
   - the requested blood group
   - `available: true` (🔴 donors never match)
   - not the requester themself
3. Matched telegramIds are stored on the request as **`matchedDonors`** and the status
   flips `OPEN → DONOR_NOTIFIED`. With zero matches the request stays `OPEN` and the
   user gets the honest "No matching donors found" message with suggestions —
   it never claims a donor exists.
4. Status transitions are guarded (`updateOne({ _id, status: "OPEN" })`), so a cancelled
   request can never be flipped by a slow matching run.

Worked example (the same scenario the test suite plants in the database):

| Donor | Group | Availability | Distance | Result |
| ----- | ----- | ------------ | -------- | ------ |
| A | O- | 🟢 | ~1 km | ✅ matched |
| B | O- | 🟢 | ~15 km | ❌ outside 10 km radius |
| C | O- | 🔴 | ~0.1 km | ❌ unavailable |
| D | A+ | 🟢 | ~0.05 km | ❌ wrong blood group |

`npm run test:db` now plants exactly these donors at controlled distances (1° latitude
≈ 111 km is used to place them) and proves only donor A survives — 23 checks total.

## Step 10 — Donor notifications (new)

Every matched donor now receives the 🚨 alert through **`services/notificationService.js`**:

```
🚨 EMERGENCY BLOOD REQUEST

Blood Group: O-
Units Required: 2
Approximate Distance: 1 KM

Please help if you are available.
```

with inline buttons **🩸 I CAN DONATE** / **❌ NOT AVAILABLE** (codes
`respond:yes:<requestId>` / `respond:no:<requestId>` — they go live in Step 11).

Design points:

- **Notification abstraction (spec §27)** — the matching engine calls
  `notifyDonor(donor, request)` and never knows the channel. A WhatsApp/SMS channel
  can be added later as another service without touching matching.
- **Per-donor fault tolerance** — alerts are sent one by one; a donor who blocked the
  bot (Telegram error 403) fails alone and never silences the alert for the others.
- **Honest tallies** — the requester sees "📨 N donor(s) notified", or the special
  "matched, but none could be messaged" case when everyone blocked the bot.
- **Privacy** — only Telegram @usernames are ever shared between users; no phone
  numbers or exact addresses.
- The requester is promised: "You will receive a message here the moment a donor
  accepts" — Step 11 fulfils it.

## Step 11 — Donor accept/reject (new)

The response buttons are now live. When a donor taps **🩸 I CAN DONATE**:

1. `acceptRequest()` attempts the claim in **one atomic MongoDB update** — the filter only
   matches a request that is still claimable (`OPEN`/`DONOR_NOTIFIED`, `acceptedDonor:
   null`, and not the requester's own request). MongoDB runs filter + set as a single
   operation, so when two donors tap simultaneously, **exactly one** wins and the other
   gets `null`.
2. The winner sees "🩸 Thank you for accepting!" with the request details.
3. The requester instantly receives:

```
🎉 DONOR FOUND!

Blood Group: O-
Required Units: 2

A donor (@username) has accepted your request.
Please contact the donor through Telegram and coordinate safely.

Request ID: 6ab7...
```

Only the public Telegram @username is shared — never phone numbers or exact locations.

Edge cases handled server-side (spec §15, §24):

| Situation | Message to the late/denied donor |
| --------------------------------------------- | ------------------------------------------- |
| Another donor already accepted | "⚠️ This request has already been accepted by another donor." |
| Request cancelled/completed | "⚠️ This request is no longer active..." |
| Donor taps their own request | "⚠️ You cannot accept your own blood request." |
| Donor taps ❌ NOT AVAILABLE | "👍 No problem — you will not be contacted for this request." (id recorded once) |

The proven race condition (in `npm run test:db`): two `acceptRequest()` calls fire via
`Promise.all` on the same request — exactly one wins, the late acceptor is rejected,
self-acceptance and cancelled-request claims are impossible.

## Steps 12–13 — Requester notification, status & cancellation (new)

**Step 12 (requester 🎉 notification)** shipped together with Step 11: the moment a
donor's claim succeeds, `notifyRequester()` sends the DONOR FOUND message to the
requester's chat.

**Step 13** completes the request lifecycle:

- **`/status`** lists the user's 5 most recent requests with live status from Atlas:

```
📋 My Blood Requests

• 📨 DONOR_NOTIFIED — O-, 2 unit(s), 10 KM
  ID: 6ab7...
  Created: 26/9/2026, 14:32

Active requests can be withdrawn with /cancel.
```

- **`/cancel`** now understands context:
  1. Inside a wizard → cancels the conversation (as before).
  2. With an active request (OPEN/DONOR_NOTIFIED) → withdraws it atomically and reports
     how many donors had been notified. A status-guarded update means a request that was
     just accepted, completed or already cancelled can never be flipped.
  3. With a DONOR_FOUND request → refusal: "already accepted by a donor, coordinate
     through Telegram" (cancelling would break the donor's expectation).
  4. With nothing running → "Nothing to cancel."
- **Lifecycle complete:** `OPEN → DONOR_NOTIFIED → DONOR_FOUND → COMPLETED`
  (completion handling arrives with the dashboard step) `… or CANCELLED at any point
  before acceptance.`
- The duplicate-request guard (Step 8) uses the same status list, so after cancelling,
  creating a new request works immediately — proven in the test suite.

The core emergency workflow is now **end-to-end**: register → request → match → notify
→ accept → requester notified → cancel/status tracking.

## Step 15 — React admin dashboard (new)

A simple Vite + React dashboard in `client/` (plain CSS, **no Tailwind**):

- **Login** — enter the shared admin key from `server/.env`. ⚠️ **Prototype-only auth**
  (spec §23): a single shared key sent in the `x-admin-key` header. This is NOT
  production security. While `ADMIN_API_KEY` is unset, the endpoints are open (local-dev
  convenience) — set a key before the demo.
- **Five stat cards** — Total donors · Available donors · Active requests ·
  Donor found count · Completed requests.
- **Recent requests table** — blood, units, radius, status (with icons), created.
- **Donors table** — latest 50 with blood group and 🟢/🔴 availability.
- Auto-refreshes every 15 s; logs out automatically if the key is rejected.

### REST endpoints added (server)

| Endpoint | Purpose |
| -------- | ------- |
| `GET /api/admin/stats` | the five counters |
| `GET /api/admin/requests?limit=10` | recent requests (max 50) |
| `GET /api/admin/donors` | latest 50 donors |

All respond `{ success, ... }` and require `x-admin-key` **only when `ADMIN_API_KEY` is
set** in `server/.env` (unset = open, for local development convenience).

### Run it

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm install && npm run dev
# open http://localhost:5173
```

During development Vite proxies `/api/*` to `http://localhost:5000` (see
`client/vite.config.js`), so no CORS setup is needed. `npm run build` produces a static
`dist/` ready for free static hosting (Step 17).

### How the pieces fit together

```
Telegram app  <--polling-->  server/bot/bot.js  -->  services/telegramService.js  -->  Telegram API
Telegram app  <--buttons-->  server/server.js    -->  MongoDB Atlas
```

---

## Installation

```bash
# 1. Go into the project
cd Bloodconnect
cd server

# 2. Install dependencies
npm install

# 3. Create your .env (this file already exists, just fill in the values)
```

### Environment variables

| Variable             | Where to get it                                                      |
| -------------------- | -------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Open Telegram → search **@BotFather** → `/newbot` → copy the token    |
| `MONGODB_URI`        | MongoDB Atlas → *Cluster* → *Connect* → *Drivers* → copy the string  |
| `PORT`               | Any free port locally, e.g. `5000`                                    |

Never paste your token or database password directly into a `.js` file.

---

## How to run the backend

```bash
cd Bloodconnect/server
npm run dev
```

- `npm run dev` — development mode, restarts automatically on file change (nodemon)
- `npm start` — normal run without auto-restart

Expected terminal output (with token + database filled in):

```
[server] BloodConnect API running on http://localhost:5000
[db] MongoDB connected -> <your cluster host>
[bot] Connected to Telegram as @your_bot_username
[bot] Polling for updates...
```

If the token or database is still empty the server still starts and prints a clear warning, so you
can work on the code before finishing setup.

---

## How to test

### Test 1 — REST health check

Open a browser or run:

```bash
curl http://localhost:5000/api/health
```

**Expected response:**

```json
{ "success": true, "message": "BloodConnect server is running" }
```

### Test 2 — Telegram `/start`

1. With the server running, open Telegram.
2. Search for your bot and press **Start** (or send `/start`).

**Expected reply:**

```
🩸 Welcome to BloodConnect!

Emergency blood donor connection system.

Choose an option:
🩸 Register as Donor
🚨 Emergency Blood Request
❓ Help
```

A reply keyboard appears at the bottom with 5 buttons. Tapping 🚨 Emergency Blood Request, 👤 My
Profile or 📋 My Requests replies with a "feature not built yet" message — expected at Step 3.

### Test 3 — Telegram `/help`

Send `/help`.

**Expected:** the help message plus the health disclaimer.

### Test 4 — Donor registration (happy path)

1. Send `/register`.
2. Type `Asha` when asked for the name.
3. Tap the `O+` button.
4. Tap `🟢 Available`.
5. Tap `📍 Share Location` and confirm in Telegram's map dialog.

**Expected:** a summary message:

```
✅ Donor profile saved!

Name: Asha
Blood group: O+
Availability: 🟢 Available
Location: ✅ saved (12.9716, 77.5946)

You will now be notified when someone nearby needs your blood group.
```

and the main-menu keyboard comes back at the bottom.

### Test 5 — Validation and cancel

1. Send `/register`, then type `A` as the name.
   **Expected:** `⚠️ Please enter a name between 2 and 50 characters...` — same question re-asked.
2. Type `AB-` with the keyboard instead of tapping a button (or type `hello`).
   **Expected:** the blood-group warning + buttons re-appear.
3. Type `cancel` during any step.
   **Expected:** `❌ Registration cancelled. Nothing was saved.` and the menu returns.
4. Send `/register` again — the wizard restarts from Step 1 (fresh session).

### Test 6 — Location edge cases (Step 4)

1. At the location step, type `hello` instead of sharing.
   **Expected:** `⚠️ I'm waiting for your location. Tap the 📍 Share Location button, or type /cancel.`
2. Share a **live** location (tick "share live location" in the dialog).
   **Expected:** a warning asking for a static location, and the Share button again.
3. Send a location while NOT in any conversation (just tap the attachment 📎 → Location).
   **Expected:** a friendly explanation that location is used during registration/requests.
4. Share a static location at the right step.
   **Expected:** the full summary with `Location: ✅ received (<lat>, <lon>)`.

### Test 8 — Profile & availability toggle (Step 6)

1. After registering, send `/profile`.
   **Expected:** your profile card with name, blood group, availability, location and date.
2. Tap **🔴 Set Not Available**.
   **Expected:** the SAME message updates in place — availability now 🔴, button now reads
   🟢 Set Available.
3. Tap **🟢 Set Available** to flip back.
4. In Atlas (Browse Collections → `users`), confirm the `available` field changed —
   the database is the source of truth, not the buttons.
5. Send `/profile` on a fresh Telegram account (or before registering):
   **Expected:** "You are not registered as a donor yet" guidance message.
6. Tap **🔄 Re-register**.
   **Expected:** the registration wizard starts from Step 1.

### Test 9 — Emergency request wizard (Step 7)

1. Send `/request`.
   **Expected:** "Step 1 of 4 — Which blood group is required?" with blood-group buttons.
2. Tap `O+`.
   **Expected:** "Step 2 of 4 — How many units..." (keyboard hidden so you type).
3. Type `2`.
   **Expected:** "Step 3 of 4 — 📍 Share the location..." with the Share Location button.
4. Share a static location.
   **Expected:** "Step 4 of 4 — How far may a donor be..." with radius buttons.
5. Tap `10 KM`.
   **Expected:** the 🚨 confirmation card with your exact values + Submit/Cancel buttons.
6. Tap **✅ Submit Request**.
   **Expected:** "✅ Emergency request submitted!" plus the note that storage/matching
   arrive in Steps 8–10 (expected at this stage).

### Test 10 — Request validation & cancel (Step 7)

1. At the units step type `abc` or `99`.
   **Expected:** "Please type a whole number between 1 and 10" — question re-asked.
2. At the blood-group step type `hello`.
   **Expected:** warning + blood-group buttons again.
3. Start `/request`, then type `cancel` at any step.
   **Expected:** "❌ Emergency request cancelled. Nothing was sent to any donor."
4. After finishing one request, tap Submit on the OLD confirmation card twice
   (or reuse an old card after starting a new request).
   **Expected:** "This request card is no longer active" — stale cards cannot submit.

### Test 11 — Request persistence (Step 8)

1. Submit a request (Test 9 steps 1–6).
   **Expected:** the success message now includes a **Request ID** and `Status: OPEN`.
2. Atlas → Cluster0 → `test` → `bloodrequests`.
   **Expected:** a document with your Telegram id, blood group, units, GeoJSON location,
   radius, `status: "OPEN"`, empty `matchedDonors`, `acceptedDonor: null`.
3. Submit a second request without cancelling the first.
   **Expected:** "You already have an active blood request" showing the first request's
   ID and status — and no new document in Atlas.
4. `npm run test:db` now also covers request creation, GeoJSON storage, the
   duplicate-request guard, the matching-engine scenario above, notification message
   building, and cleanup.

### Test 12 — Donor notifications (Step 10)

1. Use a **second Telegram account** (or a friend): register as an O- donor, 🟢
   available, location near you.
2. From your main account: `/request` → O- → 2 units → your location → 10 KM → Submit.
   **Expected (requester):** "📨 1 donor(s) notified."
3. Switch to the donor account.
   **Expected:** the 🚨 alert with blood group, units, distance and the two response
   buttons under the message.
4. Tap **🩸 I CAN DONATE**.
   **Expected (this stage):** "💡 Response buttons go live in Step 11" — expected at
   Step 10; acceptance arrives next.
5. Tap **❌ NOT AVAILABLE**.
   **Expected:** the same placeholder message (the buttons are wired to the real flow
   in Step 11).
6. With no donors matching: submit a request for a rare group with nobody around.
   **Expected:** the honest "No matching donors found" message.

### Test 13 — Donor acceptance (Step 11)

1. Repeat Test 12 steps 1–3 (donor B receives the alert).
2. Donor B taps **🩸 I CAN DONATE**.
   **Expected (donor):** "🩸 Thank you for accepting!" with the blood group and units.
   **Expected (requester A):** "🎉 DONOR FOUND!" with the donor's @username and Request ID.
3. Check Atlas: the request is `status: "DONOR_FOUND"` with `acceptedDonor: <B's id>`.
4. Register a third account C as an O- donor nearby, then have A submit a NEW request
   and let BOTH B and C receive the alert.
5. B taps accept first, then C taps accept.
   **Expected (C):** "⚠️ This request has already been accepted by another donor."
6. Tap **❌ NOT AVAILABLE** on another alert.
   **Expected:** "👍 No problem..." and the id appears once in `rejectedDonors` in Atlas.

### Test 14 — Status & cancellation (Steps 12–13)

1. Send `/status` with no requests.
   **Expected:** "You have no blood requests yet."
2. Create a request, then send `/status`.
   **Expected:** the request listed with 🟠 OPEN or 📨 DONOR_NOTIFIED, its ID and creation time.
3. Send `/cancel`.
   **Expected:** "❌ Request cancelled." including how many donors had been notified.
4. Send `/status` again.
   **Expected:** the request now shows ❌ CANCELLED.
5. Send `/cancel` once more.
   **Expected:** "Nothing to cancel — no operation is running and no active request."
6. Create a new request after the cancellation.
   **Expected:** works immediately (the active-request guard cleared).
7. Have a donor accept a request, then try `/cancel` as the requester.
   **Expected:** "already been accepted by a donor, so it cannot be cancelled here."

### Test 15 — Admin dashboard (Step 15)

1. Start the backend and the client (`npm run dev` in both folders).
2. Open http://localhost:5173 → login screen appears.
3. Enter the admin key (from `server/.env`) → dashboard opens.
4. Register a donor / submit a request in Telegram → within 15 s the cards and tables
   update without a page reload.
5. Statuses in the requests table must match `/status` in Telegram and Atlas.

1. Complete `/register` (all 4 steps).
   **Expected:** the final message starts with `✅ Donor profile saved!`
2. Atlas → your cluster → **Browse Collections** → the database from your `MONGODB_URI` →
   the `users` collection.
   **Expected:** one document with your `telegramId`, `name`, `bloodGroup`,
   `location.type: "Point"`, `location.coordinates: [longitude, latitude]`, `available`,
   and `createdAt`/`updatedAt`.
3. Run `/register` again with a different blood group.
   **Expected:** still **one** document for you — `bloodGroup` and `updatedAt` changed,
   no duplicate created (upsert proof).
4. Optional CLI check with `mongosh`:

   ```js
   db.users.find().pretty()
   ```

---

## Common errors and fixes

| Error                                                    | Fix                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN is missing`                           | Token not in `server/.env`, or the file is not in the `server/` folder |
| `Telegram API error in getMe: Unauthorized`               | Token was copied with extra spaces/quotes, or it was regenerated      |
| `Telegram API error in getUpdates: Conflict`              | The same bot token is being polled in two places — stop the other one |
| `MONGODB_URI is not set`                                  | Paste the Atlas connection string into `server/.env`                  |
| `MongoDB connection failed: ... IP not whitelisted`        | Atlas → *Network Access* → add `0.0.0.0/0` (fine for local dev only)  |
| `EADDRINUSE: port 5000 already in use`                    | Change `PORT` in `.env`                                              |
| Bot replies but keyboard is missing                        | Make sure `sendMessage` receives `reply_markup`                      |
| `Cannot GET /api/health`                                  | The server is not running, or you used the wrong port                 |

---

## What each technology does (quick notes)

- **Node.js** — runs JavaScript on the server instead of only in the browser.
- **Express.js** — small library that turns Node into a web server that answers URLs like `/api/health`.
- **Telegram Bot API** — an HTTP API. Every action (send message, read message) is a POST request to
  `https://api.telegram.org/bot<TOKEN>/<method>`.
- **Long polling** — instead of Telegram pushing messages to us, our server keeps one request open
  and asks "any new messages?". It returns after ~25 seconds, then we ask again. Ideal for local
  development because no public HTTPS URL is needed. We move to a **webhook** after deployment.
- **MongoDB + Mongoose** — MongoDB stores the documents (JSON-like records). Mongoose is the library
  that defines the shape of those documents and talks to MongoDB.
- **dotenv** — loads `server/.env` into `process.env` so secrets stay out of your source code.
- **CORS** — lets a browser app on a different port (the future React dashboard) call this API.
- **In-memory session Map** — remembers where each user is in a multi-step conversation. It is
  cleared whenever the server restarts, which is acceptable for a prototype.
- **Reply keyboard** — the buttons at the bottom of the chat. Its payload uses the
  `keyboard:` field with `{ text: ... }` buttons; `{ remove_keyboard: true }` hides it again
  during multi-step conversations.
- **GeoJSON + 2dsphere** — MongoDB's coordinate format (`[longitude, latitude]`!) and the
  index type that powers "within X km" queries. The index is created by the `User` model;
  matching uses it fully in Step 9.
- **Upsert** — update-if-exists, insert-if-not. Keeps one clean donor document per Telegram
  user even if they re-register many times.

---

## Git & GitHub

The project is a Git repository with `main` as the default branch. `.gitignore` blocks
`node_modules/`, **all `.env` files** (secrets!), `dist/`, logs and editor files — verify
before every push with `git status`.

Local commands used:

```bash
git init -b main          # create the repo (already done)
git add .                 # stage everything except git-ignored files
git status               # ALWAYS check nothing sensitive is staged
git commit -m "message" # save a snapshot
git branch -M main       # rename the branch to main
git remote add origin https://github.com/<your-username>/bloodconnect.git
git push -u origin main  # first push; afterwards just: git push
```

To publish: create an empty repository on github.com (**no** README/.gitignore — we have
ours), then run the two `git remote` / `git push` commands above.

**Golden rules**

1. Secrets live only in `server/.env` (git-ignored). The committed `.env.example` is a
   template with empty values.
2. Never `git push` a commit that contains a token or password. If it happens: rotate the
   secret in Atlas/BotFather immediately, then rewrite history.
3. Commit in small logical steps so the history explains the project.

---

## Deployment (free tier)

Architecture: **Atlas M0 (free DB)** + **Render free web service** (Node backend + bot)
+ **Render free static site** (dashboard). Total cost: ₹0.

### A. Backend — Render Web Service

1. Repo on GitHub (Step 16) → render.com → **New +** → **Web Service** → connect the repo.
2. Settings: **Root Directory** `server` · Build `npm install` · Start `npm start` ·
   Instance type **Free**.
3. Environment tab — add exactly these (values from your local `server/.env`):
   `TELEGRAM_BOT_TOKEN`, `MONGODB_URI`, `ADMIN_API_KEY`.
4. Atlas → Network Access → add `0.0.0.0/0` (Render has no fixed IPs on free tier).

### B. Dashboard — Render Static Site

**New +** → **Static Site** → same repo → Root Directory `client`, Build
`npm install && npm run build`, Publish `dist`. If the backend URL differs from the
blueprint default, set `VITE_API_URL` (e.g. `https://bloodconnect-server.onrender.com`)
and rebuild. Rewrite rule `/* → /index.html` so page refreshes work.

### One-click alternative

A `render.yaml` Blueprint ships with the repo: Render → **New +** → **Blueprint** →
pick the repo → fill the 3 secrets → Deploy. Secrets are set in the dashboard, never in
the file.

### Free-tier limits you must know (checked 2026 — re-verify before your demo)

| Limit | Meaning in practice |
| ----- | ------------------- |
| Web service spins down after ~15 min without inbound HTTP | The bot stops responding. Polling traffic doesn't count — only HTTP requests do. First visitor after a sleep waits 30–60 s. |
| ~750 free instance hours/month | Enough for one free service 24/7; a second one shares the budget. |
| Static sites free | No limits that matter for the demo. |
| Atlas M0 free forever | Shared CPU; fine for prototype traffic. |
| No persistent disk | Nothing on the server filesystem survives a restart — MongoDB is the only storage. |

**Keeping the bot awake during the demo** (pick one):

1. **Cron pings** (recommended): free uptime pinger hitting `https://<service>.onrender.com/api/health` every 5–10 min.
2. **Send an HTTP request manually** before the demo (open the health URL in a browser) — wakes the service in ~30 s.
3. Leave the Render dashboard open on the Logs tab — activity can keep it alive while you watch.

Render's own docs, not the blueprint, are the source of truth if limits change.

---

## Limitations (prototype only)

- Conversation sessions live in memory, so a server restart drops in-progress wizards.
- Admin API uses a single shared key — prototype protection, not real security.
- No donor verification of any kind; Telegram polling requires the backend to be awake.
- One active request per requester; matching is capped at 50 donors per request.

---

## Next steps

**Step 14 — Consolidated testing & error handling** is largely baked in (33 automated
database checks, validated wizards, guarded transitions). After that,
**Step 15 — React admin dashboard**: totals, donor-found counts and the recent-requests
table over the existing REST endpoints.

## License

MIT
