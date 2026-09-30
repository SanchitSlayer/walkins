// Browser origins allowed to call the API with credentials, shared by HTTP
// CORS and the live-board socket. A phone testing check-in reaches the web
// app over HTTPS at the laptop's network address, so this is configurable.
export const WEB_ORIGINS = (process.env.WEB_ORIGINS ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
