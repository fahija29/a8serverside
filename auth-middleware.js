import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const JWKS_TTL = 10 * 60 * 1000;

let jwks = {
    keys: [],
    fetchedAt: 0,
};

function authBaseUrl() {
    const url = (
        process.env.BETTER_AUTH_URL || ""
    ).replace(/\/+$/, "");

    if (!url) {
        throw new Error(
            "BETTER_AUTH_URL is not set in .env. Add it (the frontend URL, e.g. http://localhost:3000 in dev) before using authenticated routes."
        );
    }

    return url;
}

async function loadJwks(forceRefresh = false) {
    if (
        !forceRefresh &&
        jwks.keys.length > 0 &&
        Date.now() - jwks.fetchedAt < JWKS_TTL
    ) {
        return;
    }

    const response = await fetch(
        `${authBaseUrl()}/api/auth/jwks`
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

        let key = jwks.keys.find(
            (item) =>
                item.kid === kid &&
                item.kty === "EC" &&
                item.crv === "P-256" &&
                (!item.use || item.use === "sig") &&
                (!item.alg || item.alg === "ES256")
        );

        if (!key) {
            await loadJwks(true);

            key = jwks.keys.find(
                (item) =>
                    item.kid === kid &&
                    item.kty === "EC" &&
                    item.crv === "P-256" &&
                    (!item.use || item.use === "sig") &&
                    (!item.alg || item.alg === "ES256")
            );
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