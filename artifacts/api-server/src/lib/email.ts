/**
 * Email sender - Google SMTP (smtp.gmail.com) or any SMTP.
 *
 * Google setup:
 * 1. Google Account → Security → 2-Step Verification ON
 * 2. App passwords → generate for "Mail"
 * 3. Env:
 * SMTP_HOST=smtp.gmail.com
 * SMTP_PORT=587
 * SMTP_SECURE=false
 * SMTP_USER=you@gmail.com
 * SMTP_PASS=<16-char app password>
 * SMTP_FROM=Orbit <you@gmail.com>
 *
 * Without SMTP_HOST, codes are logged (local only). Production requires SMTP.
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";

interface MailOptions {
 to: string;
 subject: string;
 text: string;
 html?: string;
}

export async function sendEmail(opts: MailOptions): Promise<void> {
 const host = process.env.SMTP_HOST?.trim();
 const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

 if (!host) {
 if (isProd) {
 throw new Error("SMTP_HOST is required in production (e.g. smtp.gmail.com)");
 }
 logger.info({ to: opts.to, subject: opts.subject }, "[DEV EMAIL - no SMTP configured]");
 logger.info(opts.text);
 return;
 }

 const port = Number(process.env.SMTP_PORT ?? 587);
 const secure = process.env.SMTP_SECURE === "true" || port === 465;

 const transporter = nodemailer.createTransport({
 host,
 port,
 secure,
 auth: {
 user: process.env.SMTP_USER,
 pass: process.env.SMTP_PASS,
 },
 });

 await transporter.sendMail({
 from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "Orbit <noreply@orbit.app>",
 to: opts.to,
 subject: opts.subject,
 text: opts.text,
 html: opts.html,
 });

 logger.info({ to: opts.to, subject: opts.subject }, "Email sent");
}

export function otpEmailHtml(code: string, purpose = "sign in"): string {
 return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px">
 <div style="max-width:480px;margin:auto;background:#1a1d2e;border-radius:12px;padding:40px">
 <h2 style="color:#7c6bff;margin-top:0">Your Orbit verification code</h2>
 <p style="color:#94a3b8">Use this code to ${purpose}. It expires in <strong>10 minutes</strong>.</p>
 <div style="background:#0f1117;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
 <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#7c6bff">${code}</span>
 </div>
 <p style="color:#64748b;font-size:12px">If you didn't request this, ignore it. Never share this code.</p>
 </div>
</body>
</html>`;
}
