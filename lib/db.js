import mongoose from "mongoose";

// One shared connection per server process (Next reuses the module between requests; dev hot-reload keeps it on global).
const g = globalThis;
g.__cxMongo ||= { conn: null, promise: null };

export async function db() {
  if (g.__cxMongo.conn) return g.__cxMongo.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  g.__cxMongo.promise ||= mongoose.connect(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
  g.__cxMongo.conn = await g.__cxMongo.promise;
  return g.__cxMongo.conn;
}
