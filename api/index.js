// Vercel serverless entry point.
// Reuses the Express app from index.js — same routes,
// same middleware, same MongoDB (lazy + cached).
import app from "../index.js";

// Give cold starts enough time for the cached MongoDB
// connection + Atlas transactions (Vercel default is 10s).
export const maxDuration = 30;

export default app;
