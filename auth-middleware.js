import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const JWKS_TTL = 10 * 60 * 1000;
const JWKS_TIMEOUT = 10000;

let jwks = {
    keys: [],
    fetchedAt: 0,
};

let jwksPromise = null;

function authBaseUrl() {
    // BETTER_AUTH_URL is preferred; CLIENT_URL is accepted as a fallback
    // naming, holding the same frontend URL (its /api/auth/jwks is the
    // source of signing keys).
    const url = (
        process.env.BETTER_AUTH_URL ||
        process.env.CLIENT_URL ||
        ""
    ).replace(/\/+$/, "");

    if (!url) {
        throw new Error(
            "BETTER_AUTH_URL is not set in .env. Add your frontend URL, e.g. https://your-frontend.vercel.app."
        );
    }

    return url;
}

/**
 * Fetches and caches Better Auth JWKS.
 * Concurrent requests reuse the same fetch promise.
 */
async function loadJwks(forceRefresh = false) {
    const cacheIsValid =
        jwks.keys.length > 0 &&
        Date.now() - jwks.fetchedAt < JWKS_TTL;

    if (!forceRefresh && cacheIsValid) {
        return;
    }

    if (jwksPromise) {
        return jwksPromise;
    }

    const request = (async () => {
        const response = await fetch(
            `${authBaseUrl()}/api/auth/jwks`,
            {
                signal: AbortSignal.timeout(JWKS_TIMEOUT),
            }
        );

        if (!response.ok) {
            throw new Error(`JWKS fetch failed (${response.status})`);
        }

        const data = await response.json();

        if (!Array.isArray(data.keys) || data.keys.length === 0) {
            throw new Error("No JWKS keys available");
        }

        jwks = {
            keys: data.keys,
            fetchedAt: Date.now(),
        };

        console.log(
            `JWKS loaded from frontend (${data.keys.length} key${data.keys.length === 1 ? "" : "s"}) — frontend↔server connection OK.`
        );
    })();

    jwksPromise = request;

    try {
        await request;
    } finally {
        if (jwksPromise === request) {
            jwksPromise = null;
        }
    }
}

/**
 * Finds a valid ES256 public signing key.
 */
function findSigningKey(kid) {
    return jwks.keys.find(
        (item) =>
            item.kid === kid &&
            item.kty === "EC" &&
            item.crv === "P-256" &&
            (!item.use || item.use === "sig") &&
            (!item.alg || item.alg === "ES256")
    );
}

export async function requireAuth(req, res, next) {
    const authorization = req.headers.authorization || "";

    const token = authorization.startsWith("Bearer ")
        ? authorization.slice(7).trim()
        : null;

    if (!token) {
        return res.status(401).send({
            success: false,
            message: "Authentication required",
        });
    }

    try {
        const decoded = jwt.decode(token, {
            complete: true,
        });

        if (!decoded || typeof decoded !== "object") {
            throw new Error("Malformed JWT");
        }

        if (decoded.header?.alg !== "ES256") {
            throw new Error("Invalid JWT algorithm");
        }

        const kid = decoded.header?.kid;

        if (!kid) {
            throw new Error("JWT key ID is missing");
        }

        await loadJwks();

        let key = findSigningKey(kid);

        // Refresh JWKS if the signing key is not found.
        if (!key) {
            await loadJwks(true);
            key = findSigningKey(kid);
        }

        if (!key) {
            throw new Error("Invalid signing key");
        }

        const publicKey = crypto.createPublicKey({
            key,
            format: "jwk",
        });

        const payload = jwt.verify(token, publicKey, {
            algorithms: ["ES256"],
        });

        if (
            !payload ||
            typeof payload !== "object" ||
            typeof payload.sub !== "string" ||
            typeof payload.email !== "string"
        ) {
            throw new Error("Invalid JWT user information");
        }

        req.user = {
            id: payload.sub,
            email: payload.email,
            name:
                typeof payload.name === "string"
                    ? payload.name
                    : "",
        };

        next();
    } catch (error) {
        console.error("Authentication error:", error.message);

        return res.status(401).send({
            success: false,
            message: "Invalid or expired token",
        });
    }
}