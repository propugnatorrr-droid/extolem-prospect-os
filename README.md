# Extolem ProspectOS

Private prospecting tool built for Extolem. Finds real local businesses to call, audits their
website, and surfaces what they're missing (no chatbot, no website, no online booking, etc.)
before the call.

Not for distribution. Single shared login, gated by `middleware.ts`.

## Local development

```bash
npm install
npx prisma db push
npm run dev
```

Copy `.env.example` to `.env` and fill in the values (see below).

## Environment variables

See `.env.example` for the full list: database (Neon Postgres), Apify (lead discovery),
ABN Lookup, PageSpeed Insights, OpenRouter (natural-language search), and auth.

## Deployment

Deployed on Vercel, auto-deploys on push to `main`. Database is Neon Postgres (Vercel's native
Postgres product was discontinued; Neon via the Vercel Marketplace replaces it).
