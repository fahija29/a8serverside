import express from "express";
import { ObjectId } from "mongodb";
import { pathToFileURL } from "node:url";
import os from "node:os";
import cors from "cors";
import "dotenv/config";
import { requireAuth } from "./auth-middleware.js";
import { mongoClient, getCollections } from "./mongodb.js";

const app = express();
const PORT = process.env.PORT || 8000;

if (!process.env.PORT) {
    console.warn(
        "Warning: PORT not set in .env, defaulting to 8000."
    );
}

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());

// CORS origin(s) come from .env — BETTER_AUTH_URL is the primary frontend
// URL; CORS_ORIGINS (optional) adds more as a comma-separated list. The
// allowlist also gains the localhost/127.0.0.1 twins of every http entry,
// so browsing via http://127.0.0.1:3000 or a LAN URL isn't broken by an
// origin-string mismatch (the browser blocks any non-matching response).
//
// CLIENT_URL is accepted as a fallback naming (some hosts set it instead);
// it must hold the same frontend URL.
const frontendOrigin = (
    process.env.BETTER_AUTH_URL ||
    process.env.CLIENT_URL ||
    ""
).replace(/\/+$/, "");

if (!frontendOrigin) {
    console.warn(
        "Warning: BETTER_AUTH_URL not set in .env. Set it before using authenticated routes."
    );
}

const allowedOrigins = new Set(
    [process.env.BETTER_AUTH_URL, process.env.CORS_ORIGINS]
        .flatMap((value) => (value || "").split(","))
        .map((value) => value.trim().replace(/\/+$/, ""))
        .filter(Boolean)
);

// devMode: the configured frontend is a local loopback http URL, i.e. this
// server backs a machine-local frontend (not a deployed one).
const devMode =
    frontendOrigin.startsWith("http://localhost") ||
    frontendOrigin.startsWith("http://127.0.0.1");

for (const entry of [...allowedOrigins]) {
    try {
        const parsed = new URL(entry);

        if (
            parsed.hostname === "localhost" ||
            parsed.hostname === "127.0.0.1"
        ) {
            const port = parsed.port ? `:${parsed.port}` : "";

            allowedOrigins.add(`http://localhost${port}`);
            allowedOrigins.add(`http://127.0.0.1${port}`);
        }
    } catch {
        // Not a URL — leave as stored.
    }
}

// Dev convenience: when the configured frontend is a loopback URL, this
// machine is being used for live development. Also trust its LAN IP(s)
// (192.168.x.x / 10.x / 172.16–31.x) with the same port, so browsing via
// the URL Next.js prints in its startup banner ("Network: …") works.
// A https-deployed frontend adds nothing here — production stays strict.
try {
    const frontendURL = new URL(frontendOrigin);
    const isLoopback =
        frontendURL.hostname === "localhost" ||
        frontendURL.hostname === "127.0.0.1";
    const frontendPort = frontendURL.port;
    const isPrivate = (ip) =>
        /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);

    if (isLoopback && frontendPort) {
        for (const list of Object.values(os.networkInterfaces())) {
            for (const address of list ?? []) {
                if (
                    address.family === "IPv4" &&
                    !address.internal &&
                    isPrivate(address.address)
                ) {
                    allowedOrigins.add(
                        `http://${address.address}:${frontendPort}`
                    );
                }
            }
        }
    }
} catch {
    // No usable frontend URL — keep just the explicit entries.
}

app.use(
    cors({
        // Reflect the request's Origin only when it is allow-listed; unknown
        // origins get NO Access-Control-Allow-Origin header, so the browser
        // blocks them (a fixed string here would mismatch and break access).
        
        // Non-browser tools (curl/Postman) send no Origin and pass through.
        origin: (origin, callback) => {
            // In dev (loopback-configured frontend), any localhost/127.0.0.1
            // port is trusted — Next.js may shift the dev port (3001, 3002…)
            // when 3000 is busy.
            const isDevLoopback =
                devMode && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

            if (!origin || allowedOrigins.has(origin) || isDevLoopback) {
                callback(null, true);
                return;
            }

            console.warn(
                `CORS: blocked request from origin ${origin} (not in allowlist)`
            );

            callback(null, false);
        },
        methods: ["GET", "POST", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// ==========================================
// MONGODB CONFIGURATION
// Client + collections come from ./mongodb.js
// (lazy, cached — serverless-safe)
// ==========================================

const client = mongoClient;

const ALLOWED_CATEGORIES = [
    "Fiction",
    "Science",
    "History",
    "Kids",
    "Others",
];

// ==========================================
// CUSTOM ERROR
// ==========================================

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// ==========================================
// COMMON ERROR RESPONSE
// ==========================================

function serverError(res, message) {
    return res.status(500).send({
        success: false,
        message,
    });
}

// ==========================================
// HEALTH CHECK
// GET /  and  GET /health
//
// On the Vercel serverless deployment the bare "/" path is resolved to
// this handler's source file (api/index.js) by the CDN before the
// function runs — so the canonical health endpoint is "/health", which
// always reaches the function. Keep GET / for the long-running
// `node index.js` workflow.
app.get(["/", "/health"], (req, res) => {
    res.send({
        success: true,
        message: "BookNook Server is running fine",
    });
});

// ==========================================
// 1. GET ALL BOOKS
// GET /books
// Public route
// ==========================================

app.get("/books", async (req, res) => {
    try {
        const { books: booksCollection } = await getCollections();

        const books = await booksCollection
            .find()
            .sort({ addedAt: -1 })
            .toArray();

        res.send(books);
    } catch (error) {
        console.error("Get books error:", error);
        serverError(res, "Failed to get books");
    }
});

// ==========================================
// 2. GET SINGLE BOOK
// GET /books/:id
// Protected route
// ==========================================

app.get("/books/:id", requireAuth, async (req, res) => {
    try {
        const { books: booksCollection } = await getCollections();

        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid book ID",
            });
        }

        const book = await booksCollection.findOne({
            _id: new ObjectId(id),
        });

        if (!book) {
            return res.status(404).send({
                success: false,
                message: "Book not found",
            });
        }

        res.send(book);
    } catch (error) {
        console.error("Get single book error:", error);
        serverError(res, "Failed to get book details");
    }
});

// ==========================================
// 3. ADD BOOK
// POST /books
// Protected route
// ==========================================

app.post("/books", requireAuth, async (req, res) => {
    try {
        const { books: booksCollection } = await getCollections();

        const {
            title,
            author,
            category,
            image,
            description,
            copies,
        } = req.body;

        const totalCopies = Number(copies);

        if (
            typeof title !== "string" ||
            !title.trim() ||
            typeof author !== "string" ||
            !author.trim() ||
            !ALLOWED_CATEGORIES.includes(category) ||
            typeof image !== "string" ||
            !image.trim() ||
            !Number.isInteger(totalCopies) ||
            totalCopies < 1
        ) {
            return res.status(400).send({
                success: false,
                message: "Please provide valid book information",
            });
        }

        if (!req.user?.email) {
            return res.status(401).send({
                success: false,
                message: "User authentication required",
            });
        }

        const newBook = {
            title: title.trim(),
            author: author.trim(),
            category,
            image: image.trim(),

            description:
                typeof description === "string"
                    ? description.trim()
                    : "",

            totalCopies,
            copies: totalCopies,

            addedBy: {
                name: req.user.name || "",
                email: req.user.email,
            },

            addedAt: new Date(),
        };

        const result = await booksCollection.insertOne(newBook);

        res.status(201).send({
            success: true,
            message: "Book added successfully",
            insertedId: result.insertedId,
        });
    } catch (error) {
        console.error("Add book error:", error);
        serverError(res, "Failed to add book");
    }
});

// ==========================================
// 4. UPDATE BOOK
// PATCH /books/:id
// Protected route
// Only owner can update
// ==========================================

app.patch("/books/:id", requireAuth, async (req, res) => {
    try {
        const { books: booksCollection } = await getCollections();

        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid book ID",
            });
        }

        if (!req.user?.email) {
            return res.status(401).send({
                success: false,
                message: "Authentication required",
            });
        }

        const bookId = new ObjectId(id);

        const existingBook = await booksCollection.findOne({
            _id: bookId,
            "addedBy.email": req.user.email,
        });

        if (!existingBook) {
            return res.status(404).send({
                success: false,
                message: "Book not found or you are not the owner",
            });
        }

        const {
            title,
            author,
            category,
            image,
            description,
            copies,
        } = req.body;

        const updateData = {};

        if (title !== undefined) {
            if (typeof title !== "string" || !title.trim()) {
                return res.status(400).send({
                    success: false,
                    message: "Invalid book title",
                });
            }

            updateData.title = title.trim();
        }

        if (author !== undefined) {
            if (typeof author !== "string" || !author.trim()) {
                return res.status(400).send({
                    success: false,
                    message: "Invalid author name",
                });
            }

            updateData.author = author.trim();
        }

        if (category !== undefined) {
            if (!ALLOWED_CATEGORIES.includes(category)) {
                return res.status(400).send({
                    success: false,
                    message: "Invalid book category",
                });
            }

            updateData.category = category;
        }

        if (image !== undefined) {
            if (typeof image !== "string" || !image.trim()) {
                return res.status(400).send({
                    success: false,
                    message: "Invalid book image",
                });
            }

            updateData.image = image.trim();
        }

        if (description !== undefined) {
            if (typeof description !== "string") {
                return res.status(400).send({
                    success: false,
                    message: "Invalid description",
                });
            }

            updateData.description = description.trim();
        }

        if (copies !== undefined) {
            const newTotalCopies = Number(copies);

            if (
                !Number.isInteger(newTotalCopies) ||
                newTotalCopies < 1
            ) {
                return res.status(400).send({
                    success: false,
                    message: "Copies must be at least 1",
                });
            }

            const oldTotalCopies =
                Number.isInteger(existingBook.totalCopies)
                    ? existingBook.totalCopies
                    : existingBook.copies;

            const availableCopies = existingBook.copies;

            const borrowedCopies =
                oldTotalCopies - availableCopies;

            if (
                !Number.isInteger(availableCopies) ||
                borrowedCopies < 0 ||
                newTotalCopies < borrowedCopies
            ) {
                return res.status(400).send({
                    success: false,
                    message:
                        "Cannot set copies below the number of borrowed books",
                });
            }

            updateData.totalCopies = newTotalCopies;

            updateData.copies =
                newTotalCopies - borrowedCopies;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).send({
                success: false,
                message: "No valid fields provided for update",
            });
        }

        updateData.updatedAt = new Date();

        const result = await booksCollection.updateOne(
            {
                _id: bookId,
                "addedBy.email": req.user.email,
            },
            {
                $set: updateData,
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                success: false,
                message: "Book not found",
            });
        }

        res.send({
            success: true,
            message: "Book updated successfully",
        });
    } catch (error) {
        console.error("Update book error:", error);
        serverError(res, "Failed to update book");
    }
});

// ==========================================
// 5. DELETE BOOK
// DELETE /books/:id
// Protected route
// Only owner can delete
// ==========================================

app.delete("/books/:id", requireAuth, async (req, res) => {
    try {
        const { books: booksCollection, borrows: borrowsCollection } =
            await getCollections();

        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid book ID",
            });
        }

        if (!req.user?.email) {
            return res.status(401).send({
                success: false,
                message: "Authentication required",
            });
        }

        const bookId = new ObjectId(id);

        const existingBook = await booksCollection.findOne({
            _id: bookId,
            "addedBy.email": req.user.email,
        });

        if (!existingBook) {
            return res.status(404).send({
                success: false,
                message: "Book not found or you are not the owner",
            });
        }

        const activeBorrows = await borrowsCollection.countDocuments({
            bookId: id,
        });

        if (activeBorrows > 0) {
            return res.status(409).send({
                success: false,
                message:
                    "This book has active borrows and cannot be deleted",
            });
        }

        await booksCollection.deleteOne({
            _id: bookId,
            "addedBy.email": req.user.email,
        });

        res.send({
            success: true,
            message: "Book deleted successfully",
        });
    } catch (error) {
        console.error("Delete book error:", error);
        serverError(res, "Failed to delete book");
    }
});

// ==========================================
// 6. BORROW BOOK
// POST /borrows
// Protected route
// Uses MongoDB Transaction
// ==========================================

app.post("/borrows", requireAuth, async (req, res) => {
    const session = client.startSession();

    try {
        const { books: booksCollection, borrows: borrowsCollection } =
            await getCollections();

        const { bookId, borrowDate, returnDate } = req.body;

        if (!req.user?.email) {
            return res.status(401).send({
                success: false,
                message: "Authentication required",
            });
        }

        if (!bookId || !ObjectId.isValid(bookId)) {
            return res.status(400).send({
                success: false,
                message: "Invalid book ID",
            });
        }

        const borrowedAt = borrowDate
            ? new Date(borrowDate)
            : new Date();

        const returnAt = new Date(returnDate);

        if (
            Number.isNaN(borrowedAt.getTime()) ||
            Number.isNaN(returnAt.getTime()) ||
            returnAt <= borrowedAt
        ) {
            return res.status(400).send({
                success: false,
                message: "Please provide valid borrow and return dates",
            });
        }

        const bookObjectId = new ObjectId(bookId);

        const outcome = await session.withTransaction(async () => {
            const book = await booksCollection.findOne(
                { _id: bookObjectId },
                { session }
            );

            if (!book) {
                throw new HttpError(404, "Book not found");
            }

            const existingBorrow = await borrowsCollection.findOne(
                {
                    bookId,
                    userEmail: req.user.email,
                },
                { session }
            );

            if (existingBorrow) {
                throw new HttpError(
                    409,
                    "You have already borrowed this book"
                );
            }

            const copyResult = await booksCollection.updateOne(
                {
                    _id: bookObjectId,
                    copies: { $gt: 0 },
                },
                {
                    $inc: { copies: -1 },
                },
                { session }
            );

            if (copyResult.modifiedCount === 0) {
                throw new HttpError(
                    409,
                    "This book is not available"
                );
            }

            const borrowData = {
                bookId,
                bookTitle: book.title,
                bookImage: book.image,
                userName: req.user.name || "",
                userEmail: req.user.email,
                borrowDate: borrowedAt,
                returnDate: returnAt,
                createdAt: new Date(),
            };

            const result = await borrowsCollection.insertOne(
                borrowData,
                { session }
            );

            return {
                insertedId: result.insertedId,
            };
        });

        res.status(201).send({
            success: true,
            message: "Book borrowed successfully",
            insertedId: outcome.insertedId,
        });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).send({
                success: false,
                message: error.message,
            });
        }

        if (error.code === 11000) {
            return res.status(409).send({
                success: false,
                message: "You have already borrowed this book",
            });
        }

        console.error("Borrow book error:", error);

        serverError(res, "Failed to borrow book");
    } finally {
        await session.endSession();
    }
});

// ==========================================
// 7. GET MY BORROWS
// GET /borrows
// Protected route
// ==========================================

app.get("/borrows", requireAuth, async (req, res) => {
    try {
        const { borrows: borrowsCollection } = await getCollections();

        if (!req.user?.email) {
            return res.status(401).send({
                success: false,
                message: "Authentication required",
            });
        }

        const borrows = await borrowsCollection
            .find({
                userEmail: req.user.email,
            })
            .sort({ borrowDate: -1 })
            .toArray();

        res.send(borrows);
    } catch (error) {
        console.error("Get borrows error:", error);
        serverError(res, "Failed to get borrowed books");
    }
});

// ==========================================
// 8. RETURN BOOK
// DELETE /borrows/:id
// Protected route
// Uses MongoDB Transaction
// ==========================================

app.delete("/borrows/:id", requireAuth, async (req, res) => {
    const session = client.startSession();

    try {
        const { books: booksCollection, borrows: borrowsCollection } =
            await getCollections();

        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({
                success: false,
                message: "Invalid borrow ID",
            });
        }

        if (!req.user?.email) {
            return res.status(401).send({
                success: false,
                message: "Authentication required",
            });
        }

        const borrowId = new ObjectId(id);

        await session.withTransaction(async () => {
            const borrow = await borrowsCollection.findOne(
                {
                    _id: borrowId,
                    userEmail: req.user.email,
                },
                { session }
            );

            if (!borrow) {
                throw new HttpError(
                    404,
                    "Borrow record not found"
                );
            }

            const deleteResult = await borrowsCollection.deleteOne(
                {
                    _id: borrowId,
                    userEmail: req.user.email,
                },
                { session }
            );

            if (deleteResult.deletedCount === 0) {
                throw new HttpError(
                    409,
                    "Borrow record could not be returned"
                );
            }

            if (!ObjectId.isValid(borrow.bookId)) {
                throw new HttpError(
                    400,
                    "Invalid original book ID"
                );
            }

            const bookResult = await booksCollection.updateOne(
                {
                    _id: new ObjectId(borrow.bookId),
                },
                {
                    $inc: { copies: 1 },
                },
                { session }
            );

            if (bookResult.matchedCount === 0) {
                throw new HttpError(
                    404,
                    "The original book was not found"
                );
            }
        });

        res.send({
            success: true,
            message: "Book returned successfully",
        });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).send({
                success: false,
                message: error.message,
            });
        }

        console.error("Return book error:", error);

        serverError(res, "Failed to return book");
    } finally {
        await session.endSession();
    }
});

// ==========================================
// 9. 404 HANDLER
// ==========================================

app.use((req, res) => {
    res.status(404).send({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    });
});

// ==========================================
// 10. GLOBAL ERROR HANDLER
// ==========================================

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (
        error.type === "entity.parse.failed" ||
        error instanceof SyntaxError
    ) {
        return res.status(400).send({
            success: false,
            message: "Request body must be valid JSON",
        });
    }

    console.error("Unhandled error:", error);

    res.status(error.status || 500).send({
        success: false,
        message: error.status
            ? error.message
            : "Internal server error",
    });
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

let server;

async function shutdown() {
    console.log("Shutting down BookNook server...");

    try {
        if (server) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        }

        await client.close();

        process.exit(0);
    } catch (error) {
        console.error("Shutdown error:", error);
        process.exit(1);
    }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ==========================================
// START SERVER
// Long-running mode (starts only when this file
// is the entry point, e.g. `node index.js` /
// `npm start` / `npm run dev`).
//
// On Vercel the api/index.js serverless function
// imports this file and exports `app` as the
// handler — so NO listener is started there.
// ==========================================

const isMainModule = process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;

async function startServer() {
    try {
        await getCollections();

        server = app.listen(PORT, () => {
            console.log(
                `BookNook server is running on port ${PORT}`
            );
        });

        server.on("error", (error) => {
            if (error.code === "EADDRINUSE") {
                console.error(
                    `Port ${PORT} is already in use — probably a stale "node index.js" instance. Stop the other server manually (Task Manager or "taskkill /F /PID <pid>") or run "npm run restart", which frees the port for you first. Alternatively, set a different PORT in the .env file.`
                );
            } else {
                console.error("Server error:", error);
            }

            process.exit(1);
        });
    } catch (error) {
        console.error("Server startup failed:", error);
        await client.close().catch(() => {});
        process.exit(1);
    }
}

if (isMainModule) {
    startServer();
}

// Exported for the Vercel serverless function (api/index.js).
export default app;