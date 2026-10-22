# Recon notes: TEMPLATE

> Copy this file to `recon/notes.local.md` (gitignored) and fill that copy in.
> Don't put real values in this file.
> Do recon with the **fresh wallet** only (see README, Step A).

## Where codes appear
- [ ] Main account @get_optimum. Numeric user ID:
- [ ] Team/other accounts (handle + numeric ID):
- [ ] Replies inside other threads?
- [ ] Discord announcement channel (server / channel):
- [ ] Telegram channel:
- [ ] Posted as text / image / video:
- Code format (length, charset, example from past drops; "unknown" if first drop):

## Chain and contract
- Chain / chainId:
- Mint contract address:
- Verified on explorer? Link:
- Linked from the official account? Link to post:
- Mint function + 4-byte selector:
- Price per mint:
- **Max per wallet:**
- Plain contract mint or backend voucher/signature?

## Site flow (from HAR; delete the HAR after filling this in)
- Exact SIWE `domain` string in the sign-in message:
- Are step 1–2 claims off-chain (API) or on-chain transactions?
- Does step 2 link your X account to the address? Can it be relinked?
- Code-redeem request (method + path only, no tokens):
- Session lifetime / expiry behaviour:
- CAPTCHA / Turnstile / rate limits seen:
- **Are code attempts limited or tracked per wallet?**
- Wrong-code behaviour (if tested):

## Terms / FAQ
- Automation prohibited? (quote + link):
- Codes single-use, limited supply, or shared?
- Expected drop window (date/time + timezone):
