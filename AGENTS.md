<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Architecture rules
- Custom username/password accounts (table `accounts` + `sessions`), not built-in auth — usernames may be any Unicode.
- Passwords are stored only as PBKDF2 hashes in `password_hash` (legacy plain `password` is migrated on login and blanked); no API ever returns passwords — recovery is via top-issued reset links or top setting a new password.
- Effective permissions: `accounts.permissions.acts_as` overrides the account's role for authorization (login window still uses the real role); `permissions.theme` overrides layout per account.
- All data access goes through one `rpc` server function (`src/lib/api.functions.ts` → `api.server.ts`) using the admin client; tables have RLS on with no policies so the browser can't read them directly.
- Exchange rates are stored as log10 (`rate_log10`) so huge expressions (tetration operators) stay computable; overflow is capped and marked as estimated.
- Uploaded media lives in a private bucket and is served via `/api/media/$`.
- Maps use browser-only Leaflet with OpenStreetMap streets and Esri World Imagery satellite tiles; a native base-layer control switches layers without recreating the map or its overlays.
- Map GPS coordinates set the initial view only; later updates never recenter, and manual pan/zoom prevents a late initial fix from interrupting browsing.
- Multi-account mode keeps several session tokens in localStorage with one active; switching clears the query cache.
- End-to-end checks run server-side (`run_e2e`) with temporary accounts that are always deleted; demo seeding is refused unless the request host is a preview/localhost host.
- Negative exchange rates are stored as `currencies.rate_sign = -1` with log10 of the absolute value; negative-rate balances are debts, excluded from automatic payment and settled only via `settle_debt`.
- Facility price adjustments (holidays, special dates, AI hotel multiplier) live in `facilities.rules` and are applied at charge time by `effMult`.
- Screen-admin "投屏" works by issuing a session for the target flagged `sessions.impersonated_by`; it never applies to top or ETC-admin accounts.
- Server-side AI calls use the gateway Responses API via a streamed raw fetch helper (`aiJson`) with strict JSON schema output.
- Auto-charging runs from a global `BackgroundEtc` in the app shell that heartbeats every saved 分身 session; shortfalls become negative balances in the facility currency. Discount cards live in setting `discount_cards` (keyed by account id) and are applied after `effMult` via `applyCard`.
- Payment logs trigger persistent owner-scoped receipt/ETC notifications; QR payments use a service-only transactional function that locks both accounts, moves balances and emits notifications atomically. QR URLs carry only the payee account ID, never sessions or payment authorization.
