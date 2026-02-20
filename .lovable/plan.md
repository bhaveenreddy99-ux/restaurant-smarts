
# Switch to Your Own Supabase Account

This is a manual process — I can guide you through every step clearly. No coding knowledge is required. Here's exactly what to do:

---

## Overview

Since your project currently uses Lovable Cloud (which manages Supabase automatically), switching to your own Supabase account requires:
1. Creating a new Supabase project
2. Running your database schema in it
3. Remixing this Lovable project and connecting it to your new Supabase project

**Important:** Your existing data (restaurants, inventory, users) will NOT be transferred automatically — only the structure (schema) will be migrated. You'll start fresh in the new Supabase project.

---

## Step 1 — Create a Supabase account and project

1. Go to [supabase.com](https://supabase.com) and sign up or log in
2. Click **"New project"**
3. Give it a name (e.g. "RestaurantIQ")
4. Choose a region close to you
5. Set a strong database password — **save this somewhere safe**
6. Wait ~2 minutes for the project to provision

---

## Step 2 — Run the database schema

Once your Supabase project is ready:

1. In the Supabase dashboard, click **SQL Editor** in the left sidebar
2. You need to run all 28 migration files from this project **in order**. The files are in `supabase/migrations/` and are already named with timestamps so they run in the correct sequence.

To get the SQL, you can view each file in Lovable's **Code Editor** (desktop only — top area of the preview window, code icon).

Run them in this order (oldest to newest):
```text
20260212001141_...sql   ← Core schema: profiles, restaurants, inventory
20260212003221_...sql
20260212005056_...sql
... (continue in timestamp order)
20260220121430_...sql   ← Last: logo_url column + storage bucket
```

**Tip:** You can paste multiple migration files one at a time into the SQL Editor and click "Run" after each one.

---

## Step 3 — Set up Email Auth in Supabase

1. In your Supabase project, go to **Authentication → Providers**
2. Make sure **Email** is enabled
3. Under **Authentication → URL Configuration**, set:
   - **Site URL**: your Lovable published URL (you'll get this after remixing)
   - **Redirect URLs**: same URL + `/reset-password`

---

## Step 4 — Get your Supabase credentials

1. In your Supabase project, go to **Project Settings → API**
2. Copy these two values:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (the long JWT string under "Project API keys")

---

## Step 5 — Remix this Lovable project

1. In Lovable, click the project name (top-left)
2. Go to **Settings**
3. Click **"Remix this project"** — this creates a copy of your code
4. In the remixed project, open **Settings → Connectors**
5. Find **Lovable Cloud** and **disable it** (this disconnects the auto-managed backend)
6. Then connect your own Supabase by adding:
   - `VITE_SUPABASE_URL` = your Project URL from Step 4
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = your anon key from Step 4

---

## Step 6 — Set up Storage bucket

The last migration file creates the `restaurant-logos` storage bucket, but since you're no longer using logo uploads (we replaced it with a static image), you can skip this — or run the migration anyway and it won't cause any problems.

---

## Step 7 — Set up Edge Functions secrets

Your app uses edge functions for sending emails and processing notifications. In your new Supabase project go to **Project Settings → Edge Functions → Secrets** and add:

| Secret Name | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend.com API key (for email sending) |

---

## What you'll have after this

- A fully independent Supabase project under your own account
- Complete ownership of the database, auth, and storage
- The exact same app functionality, running against your own backend
- Full access to the Supabase dashboard to view tables, users, logs, etc.

---

## Key things to know

- **This project stays as-is** — the remix is a separate copy, your current project is untouched
- **Users must re-register** in the new Supabase project (auth users don't transfer)
- **No existing data transfers** — only the schema (table structure) moves over
- **Edge function deploys** happen automatically when you publish in the remixed project

