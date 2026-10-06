# Publishing Avistay on Google Play and the App Store

The mobile apps are the same React app wrapped with [Capacitor](https://capacitorjs.com)
(`frontend/android`, `frontend/ios`). Every website improvement ships to the apps on the
next release. Builds run in GitHub Actions (`.github/workflows/mobile.yml`) — iOS needs a
Mac, so it builds on GitHub's macOS machines; you never need one.

App ID (both stores): **`com.avistay.app`** — permanent once published.

---

## 0. Before the first build (one time)

| What | Why |
|---|---|
| DNS: `api.avistay.com` → Railway backend (custom domain in Railway) | The apps call the API there (`VITE_API_URL`). |
| Railway env: `ALLOWED_ORIGINS` must include `capacitor://localhost` and `https://localhost` (already the default in `config.py`) | The app's webview origins. |
| Backend deployed with migrations through **0010** | App login tokens + account deletion. |
| **The Avistay logo**: 1024×1024 PNG with no transparency → `frontend/resources/icon.png`; also replace `frontend/public/logo.png` and `frontend/public/icons/icon-192.png` / `icon-512.png`. Then `npm run assets`. | Every icon and splash screen still shows the old "Sn" logo. |

### Moving from StayNaivasha to Avistay (avistay.com)

The code already uses Avistay and avistay.com. These outside services must follow, or things break quietly:

| Service | Change | If you skip it |
|---|---|---|
| Domain | Register **avistay.com** (check the **Avistay** name is free to trademark in Kenya — KIPI — before printing anything) | Nothing works |
| Vercel | Add `avistay.com` + `www.avistay.com`; **redirect** `staynaivasha.co.ke` → `avistay.com` (keeps Google ranking and old shared links working) | Old links die; SEO lost |
| Railway | Custom domain `api.avistay.com`; set `MPESA_CALLBACK_URL=https://api.avistay.com/api/payments/mpesa/callback`, `FRONTEND_URL=https://avistay.com`, `BACKEND_URL=https://api.avistay.com` | Paid bookings never confirm; reset/OAuth links point at the old site |
| SendGrid | Authenticate the **avistay.com** sending domain (SPF/DKIM DNS records) | Emails from `noreply@avistay.com` go to spam or bounce |
| Google Cloud (OAuth) | Add `https://api.avistay.com/api/auth/google/callback` as an authorised redirect URI | "Continue with Google" fails on the website |
| Safaricom Daraja | Rename the app / paybill display name if shown to customers | Guests see the old name on M-Pesa prompts |
| WhatsApp Business (Africa's Talking) | Update the display name — Meta re-reviews it | Messages still say StayNaivasha |
| Social | Claim `@avistay` on X/Instagram/TikTok (the site's link previews now reference `@avistay`) | Previews link to someone else's account |

Keep `staynaivasha.co.ke` registered for at least a few years — it redirects old links and protects the old name.

## 1. Accounts

| | Google Play | Apple App Store |
|---|---|---|
| Sign up | play.google.com/console | developer.apple.com/programs |
| Cost | US$25 once | US$99 per year |
| As a company (recommended) | Needs a **D-U-N-S number** (free from Dun & Bradstreet, ~1–2 weeks) | Same D-U-N-S number |
| Identity check | Government ID + phone | Government ID; company docs |
| Gotcha | **New personal accounts must run a closed test with 12+ testers for 14 days** before going public. Organisation accounts skip this. | Review usually takes 1–3 days. |

Recommendation: register as an organisation (company) on both — it also shows "Avistay Ltd" instead of your personal name in the stores.

## 2. Signing keys (keep these safe — losing them is painful)

### Android upload key
```bash
keytool -genkeypair -v -keystore avistay-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 avistay-upload.jks   # → GitHub secret ANDROID_KEYSTORE_BASE64
```
Store the `.jks` file and its passwords in a password manager. Enrol in **Play App Signing**
(default) — Google keeps the real signing key, so a lost upload key can be reset.

### Apple
App Store Connect → Users and Access → Integrations → **App Store Connect API** → generate a
key with **Admin** access (needed for automatic cloud signing). Download the `.p8` once.

## 3. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the `.jks` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | from step 2 |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Console → Setup → API access → service account with "Release to testing tracks" |
| `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` | from the API keys page |
| `APP_STORE_CONNECT_KEY_P8` | full contents of the `.p8` file |
| `APPLE_TEAM_ID` | developer.apple.com → Membership |

## 4. First release

1. **Create the app records** (the API can't do this):
   - Play Console → Create app → "Avistay", free, app.
   - App Store Connect → My Apps → + → bundle ID `com.avistay.app`.
2. Actions → **Mobile apps** → Run workflow (version `1.0.0`, upload off).
3. **Google Play only, first time:** download the `.aab` artifact and upload it by hand in
   Play Console → Test and release → Internal testing. After that, the workflow uploads automatically.
4. Copy the **App signing key SHA-256** (Play Console → App integrity) into
   `frontend/public/.well-known/assetlinks.json` and deploy the website — this makes shared
   links open in the app without a "choose app" prompt.
5. Test on real phones (internal testing / TestFlight) with the checklist in §7.
6. Fill in the store listing (§5) and policy forms (§6), then promote to production.

Later releases: run the workflow with a new version, or push a tag `app-v1.1.0`.

## 5. Store listing

| Item | Notes |
|---|---|
| Name | Avistay |
| Short description (Play, 80 chars) | Book verified holiday homes in Naivasha. Pay safely with M-Pesa. |
| Screenshots | Phone: home, property, price breakdown, M-Pesa screen, My bookings, report a problem. iPhone 6.9" and 6.5" sizes are required by Apple. |
| Category | Travel |
| Privacy policy URL | https://avistay.com/privacy |
| Account deletion URL (Play) | https://avistay.com/delete-account |
| Support URL / email | hello@avistay.com |

## 6. Policy forms — answers for this app

**Payments.** Bookings are a real-world service (accommodation), so Apple's in-app purchase
rules don't apply (guideline 3.1.3(e)); M-Pesa is allowed on both stores. Say so in the review notes.

**Sign-in.** The apps offer phone OTP and email only. Google sign-in is hidden in the apps on
purpose: Google blocks it inside app webviews, and Apple would then also require *Sign in with
Apple* (guideline 4.8). Add both natively later if wanted.

**Account deletion.** In-app: Profile → Delete my account. Web: /delete-account. ✔ required by both stores.

**Data collected** (Play "Data safety" / Apple "App Privacy"):

| Data | Purpose | Shared? |
|---|---|---|
| Name, phone, email | Account, booking messages | With the host of your booking |
| Payment info (M-Pesa reference, phone) | Payments, refunds | Safaricom (processor) |
| Photos | Listings, problem reports | Shown to the other party / our team |
| Approximate location? | **No** — map pins are entered by hosts, not read from the phone | — |

Photos are uploaded with location data removed. No ads, no tracking → Apple: "Data not used to track you".

**App Review notes (Apple)** — provide a demo account with an upcoming booking and explain:
"M-Pesa STK Push is a Kenyan mobile-money prompt. Reviewers outside Kenya can view bookings
and the full flow up to payment with the demo account."

## 7. Device test checklist (before every production release)

- [ ] Sign in with phone OTP; close the app for an hour, reopen — still signed in
- [ ] Book → M-Pesa prompt arrives → confirmation screen
- [ ] Cancel → refund amount shown matches the policy
- [ ] Host: add photos from **camera** and **gallery** (iPhone HEIC photo too), reorder, set cover
- [ ] Report a problem with a photo; reply in the thread
- [ ] Android back button goes back; exits from the home screen
- [ ] Notch / status bar never covers the top bar (iPhone with Dynamic Island, Android edge-to-edge)
- [ ] WhatsApp / phone links open the right apps
- [ ] Shared link `https://avistay.com/property/...` opens in the app (Android)
- [ ] Delete account works and signs you out

## 8. Not in v1 (good next steps)

- **Push notifications** via Firebase (native). The backend's FCM code uses Google's retired
  legacy API and must move to FCM HTTP v1 first.
- **iOS Universal Links** (shared links open the iOS app) — needs the Associated Domains
  capability in Xcode and `/.well-known/apple-app-site-association`.
- Native Google and Apple sign-in.
- Over-the-air web updates (e.g. Capgo) so copy fixes ship without store review.
