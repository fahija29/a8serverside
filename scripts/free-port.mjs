// Frees the BookNook API port by stopping whatever stale instance still
// holds it (e.g. a forgotten `node index.js`). Run automatically before
// `npm run restart` / `npm run dev` — so "Port 8000 is already in use"
// can't strand you; the listener is stopped and the new server takes over.
//
// Usage: node scripts/free-port.mjs [port]   (defaults to 8000 / $PORT)

import { execSync } from "node:child_process";
import { platform } from "node:os";

const port = String(process.argv[2] ?? process.env.PORT ?? 8000);

function pidsOnPort() {
    if (platform() === "win32") {
        const out = execSync("netstat -ano -p TCP", {
            windowsHide: true,
        }).toString();

        return out
            .split("\n")
            .filter((line) => line.includes("LISTENING"))
            .map((line) => line.trim().split(/\s+/))
            .filter((parts) => (parts[1] ?? "").endsWith(`:${port}`))
            .map((parts) => Number(parts[parts.length - 1]))
            .filter((pid) => Number.isInteger(pid) && pid > 0);
    }

    // macOS / Linux
    const out = execSync(`lsof -t -i :${port} -sTCP:LISTEN || true`, {
        shell: true,
    }).toString().trim();

    return out
        .split("\n")
        .map(Number)
        .filter((pid) => Number.isInteger(pid) && pid > 0);
}

let pids = [];

try {
    pids = pidsOnPort();
} catch (error) {
    console.warn(
        `Could not scan for listeners on port ${port}: ${error.message}`
    );
}

if (pids.length === 0) {
    console.log(`Port ${port} is already free.`);
} else {
    for (const pid of pids) {
        try {
            process.kill(pid, "SIGKILL");
            console.log(`Freed port ${port}: stopped stale instance (PID ${pid}).`);
        } catch (error) {
            console.warn(`Could not stop PID ${pid}: ${error.message}`);
        }
    }
}
