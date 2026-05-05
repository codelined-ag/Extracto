import nodemailer, { type Transporter } from "nodemailer";

export interface SmtpEnvelope {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpStatus {
  configured: boolean;
  fromAddress: string | null;
  host: string | null;
}

let cachedTransporter: Transporter | null = null;
let cachedSignature = "";

function readSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM?.trim();
  const secureRaw = process.env.SMTP_SECURE?.trim().toLowerCase();
  const port = portRaw ? Number.parseInt(portRaw, 10) : NaN;
  if (!host || !from) return null;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return {
    host,
    port,
    user: user || "",
    password: password || "",
    from,
    secure: secureRaw === "1" || secureRaw === "true" || port === 465,
  };
}

export function getSmtpStatus(): SmtpStatus {
  const cfg = readSmtpConfig();
  return {
    configured: Boolean(cfg),
    fromAddress: cfg?.from ?? null,
    host: cfg?.host ?? null,
  };
}

export function isSmtpConfigured(): boolean {
  return Boolean(readSmtpConfig());
}

function getTransporter(): Transporter | null {
  const cfg = readSmtpConfig();
  if (!cfg) return null;
  const signature = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.secure}`;
  if (cachedTransporter && cachedSignature === signature) return cachedTransporter;
  cachedSignature = signature;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user
      ? { user: cfg.user, pass: cfg.password }
      : undefined,
  });
  return cachedTransporter;
}

export async function sendSystemEmail(envelope: SmtpEnvelope): Promise<{ delivered: boolean; reason?: string }> {
  const cfg = readSmtpConfig();
  if (!cfg) return { delivered: false, reason: "SMTP not configured" };
  const transporter = getTransporter();
  if (!transporter) return { delivered: false, reason: "SMTP transporter unavailable" };
  await transporter.sendMail({
    from: cfg.from,
    to: envelope.to,
    subject: envelope.subject,
    text: envelope.text,
    html: envelope.html,
  });
  return { delivered: true };
}

export function getPublicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/u, "");
  const proto = process.env.PUBLIC_PROTOCOL?.trim() || "https";
  const host = process.env.PUBLIC_HOST?.trim();
  if (host) return `${proto}://${host}`.replace(/\/+$/u, "");
  return "http://localhost:3000";
}
