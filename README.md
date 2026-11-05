# BookNook API Server 📚

Express 5 + MongoDB Atlas REST API. Runs as a normal Node server locally and as a Vercel serverless function with the same code.

## Tech stack

- **Runtime:** Node.js (Node 18+ recommended)
- **Framework:** Express 5
- **Database:** MongoDB Atlas via the native `mongodb` driver
- **Auth:** JWT verification against a Better Auth JWKS endpoint

## Routes

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/` | Health check | Public |
| GET | `/books` | Get all books | Public |
| GET | `/books/:id` | Get one book | JWT |
| POST | `/books` | Add a book | JWT |
| PATCH | `/books/:id` | Update a book (owner only) | JWT |
| DELETE | `/books/:id` | Delete a book (owner only) | JWT |
| POST | `/borrows` | Borrow a book | JWT |
| GET | `/borrows` | Get borrows of logged-in user | JWT |
| DELETE | `/borrows/:id` | Return a book | JWT |

## Environment variables (see `.env.example`)

| Variable | Purpose | Local dev | Production |
|---|---|---|---|
| `MONGODB_URI` | Atlas connection string | `.env` | Vercel env vars |
| `PORT` | Local server port | `.env` | Vercel sets it automatically |
| `BETTER_AUTH_URL` | Your **frontend** URL (CORS origin + JWT/JWKS source) | `http://localhost:3000` | deployed frontend URL |

## Run locally

```bash
npm install
npm run dev      # nodemon (frees port 8000 automatically first)
# or
npm start        # plain node
# or, after a forgotten instance is still holding the port:
npm run restart  # stops the stale listener, then boots a fresh server

# health check
curl http://localhost:8000/
```

> **"Port 8000 is already in use"?** It means an earlier `node index.js`
> instance is still running. `npm run restart` (or `npm run dev`) stops
> that stale listener for you and starts fresh — see
> `scripts/free-port.mjs`.

## Deploy to GitHub

```bash
git init                         # already done if you cloned this repo
git add .
git commit -m "BookNook API"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

`.env` is git-ignored — never commit it. Use `.env.example` as the template.

## Deploy to Vercel

1. Push the repo to GitHub (above).
2. Go to [vercel.com/new](https://vercel.com/new) → Import the GitHub repo → Deploy (zero config — `api/index.js` + `vercel.json` are already set up).
3. In **Project → Settings → Environment Variables**, add:
   - `MONGODB_URI` = your Atlas connection string
   - `BETTER_AUTH_URL` = the URL where your frontend is hosted (e.g. `https://booknook-frontend.vercel.app`)
   - Leave `PORT` empty — Vercel injects its own.
4. Add all IPs to Atlas access: in **MongoDB Atlas → Network Access**, add `0.0.0.0/0` (or Vercel's outbound IPs if on Pro).

### How the Vercel setup works

- `api/index.js` imports the Express app from `index.js` and exports it as the serverless handler; `vercel.json` rewrites every route to it.
- `mongodb.js` caches the `MongoClient` on `globalThis`, so warm Lambda invocations reuse one connection instead of exhausting Atlas's connection limit.
- `index.js` only calls `app.listen()` when run directly (`node index.js`) — importing it on Vercel never spawns a listener.

### JWT auth on deployment

Protected routes verify JWTs against the JWKS published by your Better Auth frontend at `${BETTER_AUTH_URL}/api/auth/jwks`. On Vercel, make sure `BETTER_AUTH_URL` points to your deployed frontend or every authenticated call returns 401.
