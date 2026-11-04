import { MongoClient } from "mongodb";

// ==========================================
// LAZY, CACHED MONGODB CONNECTION
// - Works as a long-running server (connects once)
// - Works as a Vercel serverless function (caches
//   the client on globalThis so warm invocations
//   reuse the same connection instead of opening
//   a new one per request, which would exhaust
//   Atlas connection limits)
// ==========================================

// Resolve MONGODB_URI from env each time this module loads.
// Local: .env via dotenv. Vercel: project env vars.
const uri = process.env.MONGODB_URI?.trim();

if (!uri) {
    throw new Error(
        "MONGODB_URI is not set. Add it to your .env file (local) or to your Vercel project's Environment Variables (production)."
    );
}

// Reuse the client across function invocations.
const globalCache = globalThis;

export const mongoClient =
    globalCache.__booknookMongoClient ?? new MongoClient(uri);

globalCache.__booknookMongoClient = mongoClient;

let collectionsPromise = globalCache.__booknookCollectionsPromise;

/**
 * Connects (once) and returns { books, borrows } collections.
 * Safe to call in every request handler — the result is cached.
 */
export function getCollections() {
    if (!collectionsPromise) {
        collectionsPromise = (async () => {
            await mongoClient.connect();

            const db = mongoClient.db("BookNook");

            const books = db.collection("books");
            const borrows = db.collection("borrows");

            // Prevent duplicate borrowing by the same user.
            await borrows.createIndex(
                { bookId: 1, userEmail: 1 },
                { unique: true }
            );

            console.log("Connected to MongoDB (cached).");

            return { books, borrows };
        })();

        globalCache.__booknookCollectionsPromise = collectionsPromise;
    }

    return collectionsPromise;
}
