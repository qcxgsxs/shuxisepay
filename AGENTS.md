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
- Custom username/password accounts (table `accounts` + `sessions`), not built-in auth — usernames may be any Unicode and the top role must read passwords.
- All data access goes through one `rpc` server function (`src/lib/api.functions.ts` → `api.server.ts`) using the admin client; tables have RLS on with no policies so the browser can't read them directly.
- Exchange rates are stored as log10 (`rate_log10`) so huge expressions (tetration operators) stay computable; overflow is capped and marked as estimated.
- Uploaded media lives in a private bucket and is served via `/api/media/$`.
- Maps use Leaflet + OpenStreetMap (no API key), loaded only in the browser.
