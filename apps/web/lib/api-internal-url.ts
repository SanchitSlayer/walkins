// Where the Next.js server reaches the API: the /api proxy's destination and
// the base URL for server-rendered fetches. Browsers never use it directly.
// They call same-origin /api instead, because on a phone "localhost" is the
// phone, and an HTTPS page can't call a plain-HTTP API anyway.
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
