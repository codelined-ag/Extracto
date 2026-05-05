"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isUiLanguage } from "@/app/page-components/ui-language";
import type { UiLanguage } from "@/app/page-components/types";

const UI_LANGUAGE_STORAGE_KEY = "extracto:ui-language";

interface ForgotResponse {
  ok?: boolean;
  mailDelivered?: boolean;
  smtpConfigured?: boolean;
  confirmUrl?: string;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ForgotResponse | null>(null);
  const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("en");

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isUiLanguage(stored)) setUiLanguage(stored);
    } catch {
      void 0;
    }
  }, []);

  const t = React.useCallback(
    (it: string, en: string, fr?: string, es?: string, de?: string) => {
      switch (uiLanguage) {
        case "it":
          return it;
        case "fr":
          return fr ?? en;
        case "es":
          return es ?? en;
        case "de":
          return de ?? en;
        default:
          return en;
      }
    },
    [uiLanguage],
  );

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: location.origin },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as ForgotResponse;
      setResult(body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid place-items-center px-6">
      <div className="surface-soft rounded-2xl p-8 max-w-md w-full space-y-4">
        <h1 className="font-display text-2xl text-center">
          {t("Reset password", "Reset password", "Réinitialiser le mot de passe", "Restablecer contraseña", "Passwort zurücksetzen")}
        </h1>
        {result?.ok ? (
          <div className="space-y-3 text-sm">
            {result.mailDelivered ? (
              <p className="text-muted-foreground">
                {t(
                  "Se l'email è registrata, ti abbiamo mandato un link di reset. Controlla la posta.",
                  "If that email is registered, we sent a reset link. Check your inbox.",
                  "Si cet email est enregistré, nous avons envoyé un lien de réinitialisation. Vérifie ta boîte de réception.",
                  "Si ese email está registrado, enviamos un enlace. Revisa tu bandeja de entrada.",
                  "Wenn die E-Mail registriert ist, haben wir einen Reset-Link gesendet. Posteingang prüfen.",
                )}
              </p>
            ) : result.smtpConfigured === false ? (
              result.confirmUrl ? (
                <>
                  <p className="text-muted-foreground">
                    {t(
                      "SMTP non configurato. Apri questo link manualmente per resettare la password:",
                      "SMTP isn't configured. Open this link manually to reset:",
                      "SMTP non configuré. Ouvre ce lien manuellement pour réinitialiser :",
                      "SMTP no configurado. Abre este enlace manualmente para restablecer:",
                      "SMTP nicht konfiguriert. Öffne diesen Link manuell zum Zurücksetzen:",
                    )}
                  </p>
                  <a className="text-primary text-xs font-mono break-all hover:underline" href={result.confirmUrl}>
                    {result.confirmUrl}
                  </a>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {t(
                    "Se l'email è registrata, è stato generato un token (SMTP non configurato).",
                    "If that email is registered, a token was generated (SMTP isn't configured).",
                    "Si cet email est enregistré, un jeton a été généré (SMTP non configuré).",
                    "Si ese email está registrado, se generó un token (SMTP no configurado).",
                    "Wenn die E-Mail registriert ist, wurde ein Token erstellt (SMTP nicht konfiguriert).",
                  )}
                </p>
              )
            ) : (
              <p className="text-muted-foreground">
                {t(
                  "Se l'email è registrata, è stato avviato il reset.",
                  "If that email is registered, a reset has been started.",
                  "Si cet email est enregistré, une réinitialisation a été lancée.",
                  "Si ese email está registrado, se inició el restablecimiento.",
                  "Wenn die E-Mail registriert ist, wurde ein Reset gestartet.",
                )}
              </p>
            )}
            <Button asChild variant="outline" className="w-full">
              <Link href="/auth">
                {t("Torna al login", "Back to sign in", "Retour à la connexion", "Volver al inicio", "Zurück zur Anmeldung")}
              </Link>
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <p className="text-sm text-muted-foreground">
              {t(
                "Inserisci la tua email. Se è registrata, riceverai un link di reset entro pochi minuti.",
                "Enter your email. If it's registered, you'll get a reset link within minutes.",
                "Saisis ton email. S'il est enregistré, tu recevras un lien de réinitialisation.",
                "Introduce tu email. Si está registrado, recibirás un enlace de restablecimiento.",
                "Gib deine E-Mail ein. Falls registriert, erhältst du einen Reset-Link.",
              )}
            </p>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <Button type="submit" disabled={busy || !email} className="w-full">
              {busy
                ? t("Invio...", "Sending...", "Envoi...", "Enviando...", "Wird gesendet...")
                : t("Invia link di reset", "Send reset link", "Envoyer le lien", "Enviar enlace", "Reset-Link senden")}
            </Button>
            <div className="text-center">
              <Link href="/auth" className="text-xs text-muted-foreground hover:text-foreground">
                {t("Torna al login", "Back to sign in", "Retour à la connexion", "Volver al inicio", "Zurück zur Anmeldung")}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
