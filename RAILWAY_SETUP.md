# Hosting on Railway with Microsoft sign-in

This puts the app on Railway behind a "Sign in with Microsoft" screen. Sign-in goes through Supabase Auth; the server (`server/app.py`) checks the Supabase sign-in token on every request before it asks BSE for anything.

You do the steps below in four websites: Supabase, Microsoft Entra (Azure), Railway, then Supabase again. Keep a notes file open to paste the values you collect into, and never paste the secret into chat, email or GitHub. Every value goes straight into Supabase or Railway.

## Do I need my own users table?

No. The first time someone signs in, Supabase adds them to its own built-in user list (**Authentication → Users**). Who may sign in is decided by:

1. **Microsoft**: the app registration below is "single tenant", so only accounts in your company's Microsoft directory can sign in at all.
2. **The server**: `ALLOWED_EMAIL_DOMAINS` (e.g. `equirus.com`) rejects any other email.
3. **Optional, to allow only named people**, pick one:
   - In Microsoft Entra, turn on **Assignment required** and add the people (step B6). No code or table involved; usually the simplest.
   - Or use the `allowed_users` table in Supabase (part G).

## A. Create the Supabase project

1. Go to https://supabase.com/dashboard, sign in, click **New project**, pick a name (e.g. `bse-automation`), set a database password (save it in your password manager), choose a region close to you (e.g. Mumbai), and click **Create new project**.
2. When it is ready, open **Project Settings** (gear icon) → **API Keys**. Copy the **anon / publishable** key into your notes. This key is meant to be public.
3. Open **Project Settings → Data API** (or the project's home page) and copy the **Project URL**, which looks like `https://abcdefgh.supabase.co`.
4. Open **Authentication → Sign In / Providers → Azure**. Copy the **Callback URL** shown there, which looks like `https://abcdefgh.supabase.co/auth/v1/callback`. Leave this page open; you come back in part C.

## B. Register the app with Microsoft

You need permission to register apps in your company's Microsoft directory. If a step says you don't have access, send these steps to your IT team.

1. Go to https://entra.microsoft.com and sign in with your work account.
2. Go to **Identity → Applications → App registrations** and click **New registration**.
   - **Name**: `BSE Announcements`
   - **Supported account types**: *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI**: platform **Web**, and paste the Supabase **Callback URL** from A4.
   - Click **Register**.
3. On the app's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID** into your notes.
4. Go to **Certificates & secrets → Client secrets → New client secret**. Description `supabase`, pick an expiry (e.g. 24 months), click **Add**, and copy the **Value** column right away (not the "Secret ID"; the value is hidden once you leave the page). Put a reminder in your calendar a week before it expires, because sign-in stops working then.
5. Go to **Token configuration → Add optional claim**, choose **ID**, tick **email** and **xms_edov**, and click **Add**. If it asks to add the Microsoft Graph email permission, tick it and click **Add**. This makes Microsoft send the verified email Supabase needs.
6. Optional, to allow only named people: go to **Identity → Applications → Enterprise applications**, open **BSE Announcements**, then **Properties** → set **Assignment required?** to **Yes** → **Save**. Then **Users and groups → Add user/group** and add each person (and yourself).

## C. Turn on Microsoft sign-in in Supabase

1. Back on **Authentication → Sign In / Providers → Azure** in Supabase, switch **Enable Sign in with Azure** on and fill in:
   - **Application (client) ID**: from B3
   - **Secret Value**: from B4
   - **Azure Tenant URL**: `https://login.microsoftonline.com/<Directory (tenant) ID from B3>`
2. Click **Save**.
3. Open **Email** on the same page and switch it off, so nobody can make an account with an email and password instead of Microsoft.

## D. Deploy on Railway

1. Go to https://railway.com, sign in with GitHub, click **New Project → Deploy from GitHub repo**, and pick `goransh-gattani/bse-automation`. If the repository isn't listed, click **Configure GitHub App** and give Railway access to it.
2. Until the pull request is merged, open the new service → **Settings → Source** and set the branch to `claude/project-thread-g0ujz3`. After merging, set it back to `main`.
3. Open the service's **Variables** tab and add these (**New Variable** for each):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL from A3 |
   | `SUPABASE_ANON_KEY` | the anon / publishable key from A2 |
   | `ALLOWED_EMAIL_DOMAINS` | `equirus.com` |

   Railway redeploys after you save. `.env.example` in the repository lists the optional variables.
4. Go to **Settings → Networking → Public Networking** and click **Generate Domain**. Copy the address, e.g. `https://bse-automation-production.up.railway.app`.
5. Wait until the **Deployments** tab shows the latest deploy as **Active** (green).

## E. Tell Supabase about the Railway address

1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to the Railway address from D4.
3. Under **Redirect URLs**, click **Add URL** and add the Railway address followed by `/**`, e.g. `https://bse-automation-production.up.railway.app/**`. Click **Save**.

## F. Test it

1. Open `https://<your Railway address>/health`. It should show `ok`. If not, open the deploy's **View logs** in Railway; a message about `SUPABASE_URL` means a variable from D3 is missing.
2. Open `https://<your Railway address>/diag`. Look at `bse_reachable`:
   - `true`: BSE answers Railway's servers.
   - `false`: BSE is blocking Railway's IP addresses (it blocks many cloud servers). Sign-in still works, but lookups will fail. The GitHub Pages page with the Cloudflare Worker keeps working in the meantime, and the `results` list shows what BSE sent back, which is what to share when asking for help.
3. Open `https://<your Railway address>/`, click **Sign in with Microsoft**, sign in, and fetch a scrip code.

If sign-in fails, the message usually says why:

- **AADSTS50011 (redirect URI mismatch)**: the redirect URI in B2 isn't exactly the Supabase Callback URL from A4.
- **Error getting user email from external provider**: step B5 is missing, or the account has no email in Microsoft.
- **You land on `localhost:3000`**: the Site URL in E2 isn't set.
- **"… is not allowed to use this app"**: the email's domain isn't in `ALLOWED_EMAIL_DOMAINS`, or the person isn't in `allowed_users` (part G).
- **AADSTS50105 (not assigned)**: Assignment required is on (B6) and the person hasn't been added.

## G. Optional: an allowed users table

Use this instead of B6 if you'd rather keep the list in Supabase.

1. In Supabase, open **SQL Editor → New query**, paste everything from `supabase/allowlist.sql`, and click **Run**.
2. Open **Table Editor → allowed_users → Insert → Insert row**, type an email (start with your own), and **Save**. Repeat for each person.
3. In Railway's **Variables**, add `USE_ALLOWLIST_TABLE` = `true`.

Changes to the list take effect within five minutes.

## Later: close the public copies

The GitHub Pages page and the Cloudflare Worker don't ask anyone to sign in. Once the Railway version works for you, you can turn them off: GitHub repository **Settings → Pages → Unpublish site**, and in Cloudflare, the worker's **Settings → Delete**. Until then they remain your fallback if BSE blocks Railway.
