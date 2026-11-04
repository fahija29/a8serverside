// Vercel serverless entry point.
// Reuses the Express app from index.js — same routes,
// same middleware, same MongoDB (lazy + cached).
import app from "../index.js";

export default app;
