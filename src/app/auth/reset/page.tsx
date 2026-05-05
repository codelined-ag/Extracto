"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isUiLanguage } from "@/app/page-components/ui-language";
import type { UiLanguage } from "@/app/page-components/types";

const UI_LANGUAGE_STORAGE_KEY = "extracto:ui-language";

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordInner />
    </React.Suspense>
  );
}

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState("");
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
    if (password.length < 12) {
      setError(t("Almeno 12 caratteri", "At least 12 characters", "Au moins 12 caractères", "Al menos 12 caracteres", "Mindestens 12 Zeichen"));
      return;
    }
    if (password !== confirm) {
      setError(t("Le password non coincidono", "Passwords don't match", "Les mots de passe diffèrent", "Las contraseñas no coinciden", "Passwörter stimmen nicht überein"));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: location.origin },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || t("Reset non riuscito", "Reset failed", "Échec de la réinitialisation", "Error en el reset", "Reset fehlgeschlagen"));
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen w-full grid place-items-center px-6">
        <div className="surface-soft rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <p className="text-sm text-destructive">
            {t("Token mancante.", "Missing token.", "Jeton manquant.", "Falta el token.", "Token fehlt.")}
          </p>
          <Button asChild className="w-full">
            <Link href="/auth/forgot">
              {t("Richiedi un nuovo link", "Request a new link", "Demander un nouveau lien", "Solicitar nuevo enlace", "Neuen Link anfordern")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full grid place-items-center px-6">
      <div className="surface-soft rounded-2xl p-8 max-w-md w-full space-y-4">
        <h1 className="font-display text-2xl text-center">
          {t("Imposta nuova password", "Set a new password", "Définir un nouveau mot de passe", "Establecer nueva contraseña", "Neues Passwort festlegen")}
        </h1>
        {done ? (
          <div className="space-y-3 text-sm">
            <p>
              {t("Password aggiornata.", "Password updated.", "Mot de passe mis à jour.", "Contraseña actualizada.", "Passwort aktualisiert.")}
            </p>
            <Button asChild className="w-full">
              <Link href="/auth">
                {t("Accedi", "Sign in", "Se connecter", "Iniciar sesión", "Anmelden")}
              </Link>
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("Nuova password (min 12)", "New password (min 12)", "Nouveau mot de passe (min 12)", "Nueva contraseña (mín 12)", "Neues Passwort (mind. 12)")}
              minLength={12}
              required
            />
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("Conferma password", "Confirm password", "Confirmer le mot de passe", "Confirmar contraseña", "Passwort bestätigen")}
              minLength={12}
              required
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy
                ? t("Salvataggio...", "Saving...", "Enregistrement...", "Guardando...", "Wird gespeichert...")
                : t("Salva password", "Save password", "Enregistrer", "Guardar", "Speichern")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
