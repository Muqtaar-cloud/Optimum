# TurboBot: hands-off Optimum TurboCards claim

@get_optimum posts claim codes for the TurboCards mint at
https://turbocards.getoptimum.xyz/optimum. The site flow is:

1. Connect wallet + sign in → claim
2. Follow Optimum → claim
3. Enter the posted code → claim
4. Mint

TurboBot runs on your Windows PC. It catches the code from your Android
phone's X notification, then pushes the code to your phone. From stage 2 it
also enters the code on the site, and from stage 3 it also mints.

```
@get_optimum post → X push on Android → MacroDroid → ntfy.sh (secret topic) → TurboBot on PC
   → code alert on your phone → (stage 2) redeem on Snag → (stage 3) mint → result alert
```

| Stage | What the bot does | Status |
|---|---|---|
| 1 | Pushes the code to your phone within seconds, with a link that opens the mint page in your wallet | built |
| 2 | Also signs in and enters the code on the site | built; enable after setup + dry run |
| 3 | Also mints | stays off until you've done one mint by hand (see below) |

**What to expect:** "a few" means whatever one wallet is allowed, probably one card per code. The bot claims every code @get_optimum posts. It never uses more than one wallet or one X account. The cards are free (gas only) and non-transferable, and the mint window is about 178 days, so a manual fallback is never a disaster.

## Recon facts (from the mint page)
- Ethereum mainnet. NFT contract `0xb7d55b938ccf4be5e51c8a4c7cf975b744055d6e`. Verify it on Etherscan and check it's linked from @get_optimum.
- Free mint, code-gated ("Enter a Code" quest), runs on Snag Solutions. No CAPTCHA was seen.
- The per-wallet limit is not stated.

## Before you build anything: the gate (≈15 min)
1. **Etherscan, contract:** check it's verified and linked from @get_optimum's own post or site. If not, stop.
2. **Etherscan, existing mints:** open a few token transfers *from* `0x0000…0000` and note each transaction's **To** address, **Method ID** (4 bytes, e.g. `0x1249c58b`) and **Value**. These go in `recon/notes.local.md`. If there are no mints yet, that's expected; stage 3 waits for your own first mint.
3. **Snag Solutions terms** (snagsolutions.io): search for "bot", "automated" and "script". If automation is prohibited, run stage 1 only.

---

## Install on Windows (once)
1. Install **Node.js 20 LTS or newer** (nodejs.org) and **Google Chrome**.
2. Download this repo (Code → Download ZIP, or `git clone`), open a terminal in the folder and run:
   ```
   npm install
   copy .env.example .env
   ```
3. Generate three secrets, running this three times:
   ```
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```
   Put them in `.env` as `NTFY_TOPIC_IN`, `NTFY_TOPIC_OUT` and `RELAY_TOKEN`. **These are passwords: anyone who knows a topic can read it or post to it.**
4. Run `run-bot.bat` (double-click). It restarts the bot 10 seconds after any crash.
   - Exit codes: 2 = fix `.env`; 3 = another copy is already running; 4 = kill switch.
5. **Keep the PC on:**
   - Settings → System → Power → Sleep: **Never**.
   - Windows Update → **Pause updates for 1 week**, and set active hours to cover the drop.
   - Optional: Task Scheduler → Create Task → trigger "At log on" → action `run-bot.bat`. This only helps after a reboot if Windows logs in automatically, so pausing updates is the main defence.
6. **Kill switch:** create an empty file `data\STOP` to stop the bot within 5 seconds. Delete it to allow it to run again.

## Phone setup (Android)
### ntfy app (receives the bot's alerts)
1. Install **ntfy** from the Play Store and subscribe to your `NTFY_TOPIC_OUT` (server `ntfy.sh`).
2. In that topic's settings, let **max-priority** alerts override Do Not Disturb. Code alerts are sent at priority 5.

### X app
- Set @get_optimum notifications to **All posts**.
- Settings → Notifications → Filters: set **mentions/replies to people you follow only**, so impostor replies never produce a push.

### MacroDroid (forwards notifications)
Install **MacroDroid**, grant it **Notification access**, and then:
- **Battery:** Android Settings → Apps → MacroDroid **and X** → Battery: **Unrestricted** (no optimisation), background activity allowed.
- In MacroDroid settings, enable the foreground service / keep-alive option. This is the most common reason macros die overnight.

Create these macros. In each one, the action is **HTTP Request**:
- Method: POST
- URL: `https://ntfy.sh/<NTFY_TOPIC_IN>`
- Content type: `text/plain`
- Body: the template shown for that macro

The body must start with `OPTBOT1`, and the `@@…@@` lines must stay on their own lines. Insert variables with the magic-text button.

**1. Forward Optimum posts**
- Trigger: *Notification Received* → app **X** (any content).
- Action 1: *If* → Magic text `[notification_title]` **contains** `optimum` (ignore case).
- Action 2 (inside the If): HTTP Request with this body:
  ```
  OPTBOT1
  token: <RELAY_TOKEN>
  kind: notif
  @@TITLE@@
  [notification_title]
  @@TEXT@@
  [notification]
  @@BIG@@
  [notification_big_text]
  ```
  Use the expanded/big-text variable your MacroDroid version offers. If it has none, leave the `@@BIG@@` line empty. In that case the bot treats every post as possibly cut off and only pushes the code to you; it won't auto-claim.

**2. Listener heartbeat (SEEN)**
- Trigger: *Notification Received* → app **X** (any content).
- Constraint: this macro last ran **≥ 60 minutes** ago. Depending on version this is called "Last run time" or a run-rate limit.
- Body: `OPTBOT1` / `token: <RELAY_TOKEN>` / `kind: seen`, on three lines.
- If no SEEN arrives for 12 hours, the bot alerts "MacroDroid listener may be dead".

**3. Pipeline ping (PING)**
- Trigger: *Regular interval* every **6 hours**.
- Body: `OPTBOT1` / `token: <RELAY_TOKEN>` / `kind: ping`.
- The bot answers **"pipeline OK"** on your ntfy app.

**4. Capture (for the test, then disable it)**
- Same as macro 1, but with `kind: capture`, and the If checks for your test friend's display name.
- The bot saves the raw fields to `data\captures\`.

## Test tonight (stage 1)
1. Ask a friend to post. Use macro 4 to capture their notification, then open the file in `data\captures\`.
   - It shows exactly what the title, text and big-text fields contain on your phone.
   - Set `X_DISPLAY_NAME` in `.env` to exactly what the title shows for @get_optimum. It's usually just the display name ("Optimum"), but check a real @get_optimum notification capture if you can.
2. Temporarily point macro 1's If at the friend's name, and have them post `Code: TEST123`. Within seconds your phone should get **CODE: TEST123**. Then point macro 1 back at `optimum`.
3. Check that **pipeline OK** arrives (run macro 3 by hand) and that the SEEN macro fires (watch the bot window).

## What each alert means
| Alert | Meaning |
|---|---|
| **CODE: XXXX** | A code was found in a verified @get_optimum post. Tap it to open the mint page in your wallet. |
| **UNVERIFIED CODE: …** | The title mentions Optimum but isn't an exact match (e.g. a display-name change). Pushed to you, never auto-claimed. |
| **Optimum post: open it** | The post mentions a code but it couldn't be read safely (cut off, bundled, ambiguous). |
| **pipeline OK** | The phone → ntfy → PC path works. |
| **MacroDroid listener may be dead** | No SEEN for 12 hours. Check MacroDroid's notification access and battery settings. |
| **Relay reconnected** | The PC lost the ntfy stream for 5+ minutes. Posts made meanwhile were replayed. |
| **dry run OK** | Stage 2 dry run: the code was typed in but not submitted. |
| **Code accepted: XXXX** | The site accepted the code for the burner address shown. Mint from that address (stage 3 does it for you). |
| **Code rejected / Needs you: …** | The site rejected the code, or something unexpected happened. The bot stopped; check the screenshot and finish by hand. |
| **Wallet guard refused a request** | The page asked for something outside the allow-list. Expected in stage 2 if the site asks for a transaction, which shows its To and selector. |
| **Needs you: redo follow quest** | The session check found the quest no longer done. Run `npm run setup` again. |
| **Mint sent / MINTED** | Stage 3 sent the mint, then it confirmed. |
| **Silence** | An ntfy outage or a PC that's off can't report itself. If "pipeline OK" stops arriving every 6 hours, check the PC and phone. |

## Stage 2: auto-redeem (after stage 1 works)
The bot drives its **own** Chrome profile (`data\profile`), separate from your normal Chrome. A wallet called **TurboBot** is injected into it, and the key never leaves Node: every request from the page goes through `src/provider/guard.ts`.
- Read-only RPC calls are passed through.
- Sign-in is allowed only as a SIWE message for the burner, on mainnet, for the domain you confirm.
- Transactions are refused in stage 2.
- Everything else is refused, including `eth_sign` and `eth_signTypedData*`.

1. Fill in the wallet section of `.env`:
   - `BURNER_KEY`: the **fresh funded test wallet's** private key.
   - `RPC_URL`: any Ethereum mainnet RPC, e.g. a free Alchemy or Infura key.
2. Close `run-bot.bat`, then run **`npm run setup`**.
   - It shows the burner address. Type `yes` only if it's the test wallet.
   - Chrome opens on the mint page and the bot connects the TurboBot wallet. When the site asks it to sign in, the terminal shows the **sign-in domain**. Type `yes` only if it's the TurboCards/Snag domain; it's saved to `data\local.json`.
   - In that Chrome window, do the **Follow Optimum** quest and authorise X yourself. This is the only time you need to touch it. Don't enter any code.
   - Press Enter. The bot re-reads the quest state and sends "Setup finished" to your phone.
3. **Dry run:** set `STAGE=2` and `DRY_RUN=1` in `.env`, then start `run-bot.bat`.
   - Send a test code through macro 1, for example with the If temporarily pointed at your friend, and set `X_DISPLAY_NAME` to their name for the test.
   - Expect a **"dry run OK"** alert. The bot typed the code into the field but didn't submit it.
   - Check the screenshot in `data\screenshots\`.
4. Set `DRY_RUN=0` and restore `X_DISPLAY_NAME`. Leave it running.

How redeeming works:
- Only **verified** posts, where the title exactly equals `X_DISPLAY_NAME`, are submitted automatically.
- At most 2 codes are tried per post. The second is tried only if the site said the first was *invalid*.
- "Already used", rate limits and anything unrecognised stop the bot and alert you, with a screenshot.
- A code is recorded in `data\state.json` **before** it's submitted, so a crash or restart can never resubmit it.
- Every 2 hours the bot checks it's still signed in and the follow quest still shows as done. If not, it alerts you hours before the drop.

**The site's buttons were guessed.** The page couldn't be inspected while this was written. If the dry run alerts "could not find the code input" or similar, look at the screenshot and tell me what the buttons are called, and it's a quick fix. `WALLET_OPTION_TEXT` changes which wallet option is clicked in the connect dialog.

## Stage 3: auto-mint (off for the first drop)
Expect stage 3 to be off for the first drop: there may be no real mint transaction to copy yet. Stage 2 already secures the scarce part, the code. The mint itself has about 178 days.

1. Mint your first card **by hand** from the burner account, using the deep link from the alert.
2. Open that transaction on Etherscan and copy:
   - **To** → `MINT_TO`
   - **Method ID** (the first 4 bytes of the input data, e.g. `0x1249c58b`) → `MINT_SELECTOR`
3. Set `STAGE=3`. The bot refuses to start without both values.

From then on, after a code is accepted the bot clicks **Mint Now** on one enabled card. It only ever clicks a card that contains `MINT_CARD_TEXT`, never a button elsewhere on the page.
- The guard signs only a transaction from the burner, to `MINT_TO`, with that selector, value 0, and gas under your caps.
- If gas is above `MAX_FEE_GWEI` / `MAX_GAS_ETH`, it waits and retries for up to 30 minutes, then alerts.
- You get **Mint sent**, then **MINTED** with the Etherscan link.

## Manual fallback (keep it ready)
- Import the **same burner wallet** into your phone wallet app and select it. A code redeemed by the bot only works for that address.
- Do steps 1–2 on the phone too, in the wallet's in-app browser. Open `WALLET_DEEPLINK` once to check it lands on the burner account.

## Before the drop window
- Do one real friend-account post test.
- Confirm SEEN and pipeline OK are still arriving.
- Check that the PC is awake and the phone is charged and online.

## Safety
- `.env` holds the burner key. Never commit it, and never use your main wallet.
- Only exact-title @get_optimum posts can trigger auto actions. At most 2 codes are tried per post, and no code is ever retried. Attempted codes survive restarts (`data\state.json`).
- `recon/*.har` holds live session cookies. Never share it, and delete it after taking notes.
