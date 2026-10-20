# LinkPulse

**LinkPulse is a URL shortener that helps users create, share, and track short links.** It includes a dashboard for managing links and viewing click analytics.

## Live Demo

- **Website:** https://frontend-a0rk.onrender.com/
- **Backend health:** https://linkpulse-api-turh.onrender.com/health
- **Short-link format:** `https://linkpulse-api-turh.onrender.com/r/<short-code>`

The website and API are deployed on Render. The backend health link should return JSON containing `"status":"ok"`.

## Problem Statement

Long URLs are difficult to share and manage. It can also be hard to understand how people interact with shared links, which campaigns perform well, or whether traffic may come from automated bots.

## Solution

LinkPulse converts long URLs into short, shareable links and provides a central dashboard to organize links and review recorded redirect activity. It also classifies traffic using basic rules to separate likely-human clicks from known bots and uncertain traffic.

## Features

- Create, copy, view, edit, and archive short links.
- Use generated or custom short codes.
- Set link expiry dates and click limits.
- Organize links with campaigns and tags.
- Generate QR codes for links.
- View dashboard metrics and per-link analytics, including click activity and device/browser breakdowns when data is available and the account plan allows it.
- Classify clicks using rule-based bot detection.
- Sign up and sign in using account authentication.
- Compare Free, Pro, and Growth subscription plans.
- Demo subscription checkout for testing plan activation. **It is simulated and does not collect payment details or charge money.**

## Tech Stack

- **Frontend:** React, Vite, JavaScript, CSS, Recharts
- **Backend:** Node.js, Express.js
- **Database:** MongoDB Atlas with Mongoose
- **Authentication:** JSON Web Tokens (JWT), bcryptjs
- **Traffic processing:** MongoDB outbox processor with rule-based classification; a separate worker/queue is optional for scaling
- **Deployment:** Render (Static Site + Web Service)

## Local Setup

### Requirements

- Node.js 22 or newer
- A MongoDB Atlas database that supports transactions
- Git

### 1. Download the project

```bash
git clone https://github.com/divyanshuand6-art/99999.git
cd 99999
```

### 2. Configure and start the backend

```bash
cd backend
npm install
```

Copy `backend/.env.example` to `backend/.env` and fill in the required values. On Windows PowerShell, run:

```powershell
Copy-Item .env.example .env
```

At minimum, configure these values in `backend/.env`:

```env
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb+srv://<db-user>:<password>@<cluster-host>/linkpulse?retryWrites=true&w=majority
JWT_SECRET=replace-with-a-long-random-secret
VISITOR_HASH_SECRET=replace-with-another-long-random-secret
FRONTEND_ORIGIN=http://localhost:5173
PUBLIC_BASE_URL=http://localhost:4000
INLINE_CLICK_PROCESSOR=true
USE_REDIS=false
MOCK_BILLING_ENABLED=true
```

Replace the MongoDB placeholders and secret examples with your own values. Keep `.env` private and never commit it to GitHub.

Start the backend:

```bash
npm run dev
```

The API runs at `http://localhost:4000`. Test it at `http://localhost:4000/health`.

### 3. Configure and start the frontend

Open a **second terminal** from the project root:

```bash
cd frontend
npm install
```

Copy `frontend/.env.example` to `frontend/.env`. On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set these values in `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_PUBLIC_BASE_URL=http://localhost:4000
```

Start the frontend:

```bash
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Free Render Deployment

The deployed app uses two Render services:

1. **Static Site:** React frontend.
2. **Web Service:** Node.js/Express API and short-link redirects.

MongoDB Atlas hosts the database. The API can process click events from MongoDB without a paid background worker, making this setup suitable for a small demo on Render Free.

Set the following environment variables in Render:

**Backend (`linkpulse-api`)**

- `MONGODB_URI` — your MongoDB Atlas connection string
- `JWT_SECRET` — a long, random secret
- `VISITOR_HASH_SECRET` — a separate long, random secret
- `FRONTEND_ORIGIN=https://frontend-a0rk.onrender.com`
- `PUBLIC_BASE_URL=https://linkpulse-api-turh.onrender.com`
- `INLINE_CLICK_PROCESSOR=true`
- `MOCK_BILLING_ENABLED=true` — enables the demo checkout only
- `TRUST_PROXY=true`

**Frontend (`linkpulse-frontend`)**

- `VITE_API_BASE_URL=https://linkpulse-api-turh.onrender.com`
- `VITE_PUBLIC_BASE_URL=https://linkpulse-api-turh.onrender.com`

After changing frontend environment variables, rebuild/redeploy the Static Site. Never add database credentials or secret values to frontend variables.

## Subscription and Payment Note

Free, Pro, and Growth are application plan tiers. The current checkout is a **mock/demo payment flow**: it simulates a successful checkout and activates a plan for testing, but no money is taken. It is not suitable for collecting real payments. A real subscription product needs a payment provider integration, verified payment webhooks, and production billing/security checks.

## Notes

- Analytics depend on click events being recorded and processed. The activity graph shows **qualified clicks**, so known bots and uncertain traffic may not appear as human-qualified clicks.
- Country analytics may be empty because a geolocation provider is not configured.
- Render Free services can sleep when inactive; the first request after idle time may take longer.
- Do not use demo checkout to sell real subscriptions.

## License

Add a license file if you intend to publish this project for reuse. Otherwise, all rights remain with the project owner.
