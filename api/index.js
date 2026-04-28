// Force the usage of Edge Runtime for minimal latency
export const config = { runtime: "edge" };

// Clean the target domain by removing trailing slashes
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// Hop-by-hop headers that should not be forwarded to the destination
const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(req) {
  // Validate environment configuration
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    // Extract the path from the incoming request URL
    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);

    const out = new Headers();
    let clientIp = null;

    // Filter headers to maintain security and avoid conflicts
    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;

      // Identify the originating client IP
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }
      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }
      out.set(k, v);
    }

    // Pass the client IP forward for logging/auth purposes
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    // Perform the fetch request to the remote origin
    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual", // Handle redirects at the client level
    });
  } catch (err) {
    // Log unexpected errors during the relay process
    console.error("relay error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
