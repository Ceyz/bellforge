# Deploy Bellforge to bellforge.app — beginner step-by-step

GitHub Pages + Cloudflare DNS-only (the wallet-injection-safe setup). You already have a
GitHub account (Ceyz), git installed, and the prepared files (`public/CNAME`,
`.github/workflows/pages.yml`, `vite.config.ts base: './'`).

> 💡 Stop after **PART 3** to see the site live at `ceyz.github.io/bellforge/` WITHOUT
> touching bellforge.app. Do PART 4–5 only when you're happy with the preview.

## PART 1 — Create the repo (browser)
1. Go to **https://github.com/new**
2. **Repository name:** `bellforge`
3. **Owner:** Ceyz · **Visibility:** **Public**
4. Leave "Add a README", ".gitignore" and "license" **all unchecked**.
5. Click the green **Create repository**.
6. Keep that tab open (ignore the commands it shows — use mine below).

## PART 2 — Push your files (PowerShell)
Open PowerShell: Windows key → type `PowerShell` → Enter. Paste each block (Enter after each):

```powershell
robocopy Z:\OpCat\web Z:\bellforge-site /E /XD node_modules dist .git
cd Z:\bellforge-site
```
```powershell
git init -b main
git add -A
git commit -m "Bellforge frontend: initial deploy"
```
```powershell
git remote add origin https://github.com/Ceyz/bellforge.git
git push -u origin main
```
- If a **"Sign in to GitHub"** window pops up on the push → sign in. It uploads your files.
- Refresh the GitHub repo page → you should now see `src/`, `public/`, `package.json`, `.github/`…

## PART 3 — Turn on Pages + see the preview (browser)
1. On **github.com/Ceyz/bellforge**, click **Settings** (top bar, gear icon, far right).
2. Left menu → **Pages**.
3. "Build and deployment" → **Source** → pick **GitHub Actions** from the dropdown. (No save button — that's normal.)
4. Click the **Actions** tab (top bar). "Deploy Bellforge to GitHub Pages" runs (yellow dot) → wait for the **green ✓** (~1–2 min). If it goes red, send me a screenshot.
5. ✅ Site live at **https://ceyz.github.io/bellforge/** — open it. Full-size preview.

## PART 4 — Move the domain bellforge.app (browser, two repos)
Only when you like the preview.
1. **Old site:** github.com/Ceyz/**pokebells** → Settings → Pages → the "Custom domain" box shows `bellforge.app` → **delete the text** → **Save**.
2. **New site:** github.com/Ceyz/**bellforge** → Settings → Pages → "Custom domain" → type `bellforge.app` → **Save**.
3. GitHub runs a DNS check, then provisions HTTPS (up to ~15 min). When **"Enforce HTTPS"** becomes clickable → **check it**.

## PART 5 — Cloudflare check (no change, just verify)
1. **https://dash.cloudflare.com** → click **bellforge.app** → **DNS**.
2. The record for `bellforge.app` must show a **grey cloud ("DNS only")**, NOT orange ("Proxied").
   - If it's orange: click the cloud icon → switch to **DNS only** → Save. (Orange re-enters Cloudflare's CDN and breaks the wallet later.)

## Done
- **https://bellforge.app** → your new site.
- Old game site still at `ceyz.github.io/pokebells/`; the Bellbound game on the Nintondo content host.
- **Undo anytime:** pokebells → Settings → Pages → set Custom domain back to `bellforge.app`.

## Update the site later
Edit files in `Z:\bellforge-site`, then:
```powershell
cd Z:\bellforge-site
git add -A
git commit -m "update"
git push
```
→ it rebuilds + redeploys automatically. Keep this repo **frontend-only** — never push covenant code (`native/`, `canaries/`…) here.
