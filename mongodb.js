import { MongoClient } from "mongodb";

// ==========================================
// LAZY, CACHED MONGODB CONNECTION
// ==========================================

const uri = process.env.MONGODB_URI?.trim();

if (!uri) {
    throw new Error(
        "MONGODB_URI is not set. Add it to your .env file (local) or to your deployment environment variables."
    );
}

// Reuse the MongoDB client across serverless invocations.
const globalCache = globalThis;

export const mongoClient =
    globalCache.__booknookMongoClient ?? new MongoClient(uri);

globalCache.__booknookMongoClient = mongoClient;

let collectionsPromise = globalCache.__booknookCollectionsPromise;

/**
 * Connects to MongoDB once and returns books and borrows collections.
 * Reuses the cached connection promise.
 * Clears the failed promise so future requests can retry.
 */
export function getCollections() {
    if (!collectionsPromise) {
        const connectionPromise = (async () => {
            await mongoClient.connect();

            const db = mongoClient.db("BookNook");

            const books = db.collection("books");
            const borrows = db.collection("borrows");

            // Prevent duplicate active borrowing by the same user.
            await borrows.createIndex(
                { bookId: 1, userEmail: 1 },
                { unique: true }
            );

            console.log("Connected to MongoDB (cached).");

            return { books, borrows };
        })();

        collectionsPromise = connectionPromise.catch((error) => {
            collectionsPromise = undefined;
            globalCache.__booknookCollectionsPromise = undefined;

            console.error("MongoDB connection failed:", error.message);

            throw error;
        });

        globalCache.__booknookCollectionsPromise = collectionsPromise;
    }

    return collectionsPromise;
}