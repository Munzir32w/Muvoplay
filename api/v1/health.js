import { db } from "hatchable";
import { handler } from "lib/http.js";

export const access = "public";
export const methods = ["GET"];

export default handler(async () => {
  let database = "ok";
  try { await db.query("SELECT 1"); } catch { database = "unavailable"; }
  return { status: database === "ok" ? "ok" : "degraded", app: "Muvoplay", version: "0.1.0", database, time: new Date().toISOString() };
});