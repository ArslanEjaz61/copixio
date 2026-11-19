import mongoose from "mongoose";

const { Schema, models, model } = mongoose;

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    plan: { type: String, enum: ["none", "starter", "pro", "desk"], default: "none" },
    planUntil: { type: Date, default: null },
    wantedPlan: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A login session. The cookie carries a random token; only its SHA-256 is stored, so a database leak cannot be replayed.
const SessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    ip: String,
    ua: String,
  },
  { timestamps: true }
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One-time tokens: email verification and password reset. Hashed like sessions.
const TokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["verify", "reset"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
TokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const User = models.User || model("User", UserSchema);
export const Session = models.Session || model("Session", SessionSchema);
export const Token = models.Token || model("Token", TokenSchema);
