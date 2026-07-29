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
 * SMTP_FROM=Orbit Copilot <you@gmail.com>
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

/** Brand accents aligned with the Orbit UI gradient (orange → pink → purple). */
const BRAND = {
  orange: "#FF8A3D",
  coral: "#F25C7A",
  magenta: "#D946A8",
  purple: "#A855F7",
  violet: "#8B5CF6",
  ink: "#0B0D14",
  card: "#141824",
  cardBorder: "#2A2F42",
  text: "#F1F5F9",
  muted: "#94A3B8",
  faint: "#64748B",
};

export function appPublicUrl(): string {
  const fromEnv =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.WEBAUTHN_ORIGIN?.trim() ||
    process.env.APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "https://orbitpilot.vercel.app";
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
    from:
      process.env.SMTP_FROM ??
      process.env.SMTP_USER ??
      "Orbit Copilot <noreply@orbit.app>",
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });

  logger.info({ to: opts.to, subject: opts.subject }, "Email sent");
}

function brandShell(opts: {
  preheader: string;
  title: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  const appUrl = appPublicUrl();
  const xUrl = "https://x.com/orbit_copilot";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${opts.title}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.ink};color:${BRAND.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${opts.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.ink};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.cardBorder};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${BRAND.orange},${BRAND.coral},${BRAND.magenta},${BRAND.purple},${BRAND.violet});font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,${BRAND.orange},${BRAND.magenta},${BRAND.purple});text-align:center;vertical-align:middle;color:#fff;font-weight:700;font-size:16px;line-height:36px;">O</td>
                  <td style="padding-left:12px;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${BRAND.text};">Orbit Copilot</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 32px 28px;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px 28px;border-top:1px solid ${BRAND.cardBorder};">
              <p style="margin:20px 0 8px;font-size:13px;line-height:1.5;color:${BRAND.muted};">
                ${opts.footerNote ?? "Built on Stellar Testnet · You always sign every transaction."}
              </p>
              <p style="margin:0;font-size:13px;line-height:1.6;">
                <a href="${appUrl}" style="color:${BRAND.magenta};text-decoration:none;font-weight:600;">Open app</a>
                <span style="color:${BRAND.faint};">&nbsp;·&nbsp;</span>
                <a href="${xUrl}" style="color:${BRAND.magenta};text-decoration:none;font-weight:600;">Follow @orbit_copilot</a>
              </p>
              <p style="margin:16px 0 0;font-size:11px;color:${BRAND.faint};">
                You’re receiving this because you signed up for Orbit Copilot. If this wasn’t you, you can ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function otpEmailHtml(code: string, purpose = "sign in"): string {
  const body = `
    <h1 style="margin:12px 0 8px;font-size:22px;line-height:1.3;color:${BRAND.text};font-weight:700;">Your verification code</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND.muted};">
      Use this code to <strong style="color:${BRAND.text};">${purpose}</strong>. It expires in <strong style="color:${BRAND.text};">10 minutes</strong>.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${BRAND.ink};border:1px solid ${BRAND.cardBorder};border-radius:12px;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND.magenta};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${code}</span>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:rgba(255,138,61,0.08);border:1px solid rgba(255,138,61,0.25);border-radius:10px;">
      <tr>
        <td style="padding:14px 16px;font-size:13px;line-height:1.55;color:${BRAND.muted};">
          <strong style="color:${BRAND.orange};">Can’t find this email?</strong>
          Check your <strong style="color:${BRAND.text};">Spam</strong> or <strong style="color:${BRAND.text};">Promotions</strong> folder — security codes sometimes land there. Mark it as Not spam so future Orbit emails reach your inbox.
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.faint};">
      Never share this code. Orbit staff will never ask for it.
    </p>
  `;

  return brandShell({
    preheader: `Your Orbit Copilot code is ${code}. Expires in 10 minutes. Check spam if you don’t see it.`,
    title: "Your Orbit Copilot verification code",
    bodyHtml: body,
  });
}

export function otpEmailText(code: string, purpose = "sign in"): string {
  return [
    `Your Orbit Copilot verification code`,
    ``,
    `Use this code to ${purpose}: ${code}`,
    `Expires in 10 minutes.`,
    ``,
    `Can't find this email? Check your Spam or Promotions folder.`,
    ``,
    `Never share this code.`,
    ``,
    `Open app: ${appPublicUrl()}`,
    `Follow us: https://x.com/orbit_copilot`,
  ].join("\n");
}

export function welcomeEmailHtml(opts?: { email?: string }): string {
  const appUrl = appPublicUrl();
  const xUrl = "https://x.com/orbit_copilot";
  const hello = opts?.email ? opts.email.split("@")[0] : "there";

  const body = `
    <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.25;color:${BRAND.text};font-weight:700;">Welcome to Orbit Copilot</h1>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:${BRAND.muted};">
      Hi ${hello} — your email is verified. You’re in.
    </p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:${BRAND.muted};">
      <strong style="color:${BRAND.text};">Orbit Copilot</strong> is a chat-first DeFi control plane on <strong style="color:${BRAND.text};">Stellar</strong>.
      Instead of juggling separate apps for swaps, lending, yield, prediction markets, and NFTs, you describe what you want in plain language.
      Orbit builds the transaction; <strong style="color:${BRAND.text};">you sign with your wallet</strong>; the chain is the source of truth.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:separate;border-spacing:0 8px;">
      <tr>
        <td style="padding:14px 16px;background:${BRAND.ink};border:1px solid ${BRAND.cardBorder};border-radius:10px;">
          <div style="font-size:13px;font-weight:700;color:${BRAND.orange};margin-bottom:4px;">1 · Connect</div>
          <div style="font-size:14px;line-height:1.5;color:${BRAND.muted};">Freighter or Orbit’s passkey wallet on Stellar Testnet.</div>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 16px;background:${BRAND.ink};border:1px solid ${BRAND.cardBorder};border-radius:10px;">
          <div style="font-size:13px;font-weight:700;color:${BRAND.coral};margin-bottom:4px;">2 · Ask in chat</div>
          <div style="font-size:14px;line-height:1.5;color:${BRAND.muted};">Try “swap 10 XLM to USDC”, “show my portfolio”, or “deposit into Blend”.</div>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 16px;background:${BRAND.ink};border:1px solid ${BRAND.cardBorder};border-radius:10px;">
          <div style="font-size:13px;font-weight:700;color:${BRAND.magenta};margin-bottom:4px;">3 · Sign &amp; confirm</div>
          <div style="font-size:14px;line-height:1.5;color:${BRAND.muted};">Review the action card, sign once, then verify on-chain — not from a local balance sheet.</div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:${BRAND.text};">What you can do today</p>
    <ul style="margin:0 0 22px;padding-left:18px;color:${BRAND.muted};font-size:14px;line-height:1.7;">
      <li>Swaps &amp; DEX routes (classic path payments, StelDex, Soroswap)</li>
      <li>Lending &amp; yield (Blend, DeFindex, Meridian, Orbit Supply)</li>
      <li>Predict markets, perps, and NFT minting on Orbit contracts</li>
      <li>Portfolio intelligence — idle vs earning, next-step coaching</li>
    </ul>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr>
        <td style="border-radius:999px;background:linear-gradient(90deg,${BRAND.orange},${BRAND.magenta},${BRAND.purple});">
          <a href="${appUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Open Orbit Copilot →</a>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.28);border-radius:12px;">
      <tr>
        <td style="padding:18px 16px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${BRAND.violet};">Stay in the loop</p>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:${BRAND.muted};">
            Product updates, onboarding tips, and Stellar DeFi walkthroughs — follow us on X.
          </p>
          <a href="${xUrl}" style="display:inline-block;font-size:14px;font-weight:700;color:${BRAND.magenta};text-decoration:none;">
            x.com/orbit_copilot →
          </a>
        </td>
      </tr>
    </table>
  `;

  return brandShell({
    preheader:
      "Welcome to Orbit Copilot — chat-first DeFi on Stellar. You sign; the chain confirms. Follow @orbit_copilot.",
    title: "Welcome to Orbit Copilot",
    bodyHtml: body,
    footerNote: "Testnet only for now — practice freely with Friendbot XLM. Mainnet comes later.",
  });
}

export function welcomeEmailText(opts?: { email?: string }): string {
  const appUrl = appPublicUrl();
  const hello = opts?.email ? opts.email.split("@")[0] : "there";
  return [
    `Welcome to Orbit Copilot`,
    ``,
    `Hi ${hello} — your email is verified.`,
    ``,
    `Orbit Copilot is a chat-first DeFi control plane on Stellar.`,
    `Describe what you want in plain language. Orbit builds the transaction; you sign; the chain is the source of truth.`,
    ``,
    `Try: "swap 10 XLM to USDC", "show my portfolio", or "deposit into Blend".`,
    ``,
    `Open the app: ${appUrl}`,
    `Follow us on X: https://x.com/orbit_copilot`,
    ``,
    `Testnet only for now — practice with Friendbot XLM.`,
  ].join("\n");
}
