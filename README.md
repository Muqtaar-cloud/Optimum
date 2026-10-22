# Optimum TurboCards drop: readiness plan

@get_optimum will post claim codes for the TurboCards mint at
https://turbocards.getoptimum.xyz/optimum. The flow is:

1. Connect wallet + sign in (SIWE) → claim
2. Follow Optimum → claim
3. Enter the posted code → claim
4. Mint

**This drop has no bot.** Reading X needs the paid X API, and phone notifications from X, Discord and Telegram already arrive instantly, so a relay bot would only add delay. The plan is to do steps 1–2 ahead of time and be ready to do steps 3–4 by hand on your phone within seconds of the push.

**Expectation:** "a few" means up to the contract's **per-wallet limit**. If the limit is 1, you get one.

## Boundaries
- One wallet, one X account. No multi-wallet or sybil farming.
- No CAPTCHA solving or anti-bot bypass. No scraping X.
- Only trust codes from official accounts (by numeric ID) and only the official mint domain.

## Critical path: do these today

### Step A: Create a fresh wallet FIRST, before any recon
- Create a new wallet in your phone wallet app. This is free, and signing in needs no funds.
- Import the same key into a desktop browser wallet that you use **only** for recon.
- **Never connect your main wallet to the site.** Step 2 probably links your X account to whichever address does it, and that may not be reversible.
- Alternative: use a desktop wallet for recon but stop before step 2's final claim click. Then do the real steps 1–2 only on the phone (checklist item 3).
- If step 1–2 claims turn out to be **on-chain transactions**, send a small amount of gas before recon. Send the mint amount only after the contract is confirmed official.

Why fresh: a later automated mode can reuse the same address with a guarded signer and a new sign-in, without a second X account.

### Phase 0: Recon (with the fresh wallet)
Fill in `recon/notes.local.md`. Copy it from the template at `recon/notes.md`.

- Find where codes appear: main account, team accounts, replies, Discord, Telegram, images or video.
- In Chrome DevTools, open Network, turn on Preserve log, and walk through steps 1–2. Save the HAR in `recon/`.
- **The HAR contains your live session cookie/JWT. Never paste or share it, and delete it once your notes are written.**
- Record the chain, the contract (verified on the explorer and linked from the official account), the price, the **max per wallet**, and the exact SIWE domain.
- Record whether code attempts are limited or tracked per wallet, and whether the terms prohibit automation.

### Funding (right after recon confirms the contract and page are official)
- Fund early. Exchange withdrawals can be slow, have minimums, or not support the chain, and the chain may need bridging.
- Amount: mint price × quantity + gas buffer.

## Readiness checklist
Tick these off locally or on paper. They don't need commits.

1. [ ] In the X app, set @get_optimum notifications to **All posts** (not highlights) and allow them through Do Not Disturb/Focus. Do the same for team accounts and for any Discord announcement channel or Telegram channel that recon finds.
2. [ ] **Test delivery.** Turn on All-posts notifications for a friend's account, have them post while your phone is in your usual Focus/DND mode, and confirm the push arrives.
3. [ ] Do steps 1–2 **in the wallet app's in-app browser**, the same place you'll claim and mint. That avoids switching apps over WalletConnect.
4. [ ] Bookmark the mint page inside that in-app browser.
5. [ ] Submit a deliberately wrong code to test the error path, **but only if the FAQ makes clear that attempts aren't limited or tracked per wallet.** Skip it if that's unclear.
6. [ ] Rehearse: notification → in-app bookmark → code field ready. Paste a dummy code, and **don't submit** it if you skipped item 5. Time the run, then add an estimate for claim + mint confirmation based on the chain's block time.
7. [ ] **Shortly before the drop window,** check that you're still signed in, steps 1–2 still show as claimed, the wallet balance covers the mint, and your phone battery and data or Wi-Fi are good.

## Later drops (design only, not built)
Build an auto mode only if the terms allow it, there's no CAPTCHA, codes are text in a known format, and the latency gain is real.

- **Watcher** to feed auto mode:
  - Discord: follow the announcement channel into your own server and read it with a discord.js bot that has the Message Content intent. Accept only messages from the follow webhook's `webhook_id`.
  - Telegram: a public channel needs a user client such as GramJS or Telethon. Weigh the setup and terms risk at the time.
  - X: there's no free path, so X stays manual.
- **Guarded burner provider**: an injected EIP-1193 provider using viem, with the key in `.env`.
  - Read-only RPC calls pass through (`eth_call`, `eth_estimateGas`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionReceipt`, `eth_getTransactionCount`, `eth_gasPrice`, `eth_feeHistory`, `eth_getBlockByNumber`, `eth_chainId`, `net_version`).
  - `wallet_switchEthereumChain` is allowed only to the recon chain.
  - `personal_sign` is allowed only for EIP-4361 messages with the exact recon domain, the burner address and the right chain.
  - `eth_sendTransaction` is allowed only when `from` is the burner, `to` is the mint contract, the selector is the mint function, and value and max fee are within caps.
  - Everything else is refused and alerted, including `eth_sign`, `eth_signTypedData*`, `eth_signTransaction` and `wallet_addEthereumChain`. There's no MetaMask/Synpress fallback.
- **Claim:** Playwright with a persistent profile, run headed on a home machine.
  - Submit only candidates that match the code format exactly, at most 2 per post, with a global attempt cap.
  - A CAPTCHA aborts the run and sends a notification.
  - Run a keep-alive check on the session.
- **Mint:** `simulateContract` → `writeContract`, sent through the guard. Voucher mints go through the UI button.
- **Tests:**
  - Code-extraction fixtures: decoys, multiple codes, no code.
  - Guard refusal tests.
  - An anvil fork against the real contract.
  - A 24h keep-alive soak.
