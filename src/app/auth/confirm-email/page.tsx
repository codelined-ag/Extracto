"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isUiLanguage } from "@/app/page-components/ui-language";
import type { UiLanguage } from "@/app/page-components/types";

const UI_LANGUAGE_STORAGE_KEY = "extracto:ui-language";

type State = "idle" | "loading" | "success" | "error";

export default function ConfirmEmailPage() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = React.useState<State>("idle");
  const [message, setMessage] = React.useState<string>("");
  const [newEmail, setNewEmail] = React.useState<string>("");
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

  const submit = React.useCallback(async () => {
    if (!token) {
      setState("error");
      setMessage(
        t(
          "Token mancante nel link.",
          "Missing token in the link.",
          "Jeton manquant dans le lien.",
          "Falta el token en el enlace.",
          "Token im Link fehlt.",
        ),
      );
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/auth/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: location.origin },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => ({}))) as { email?: string; error?: string };
      if (!res.ok) {
        throw new Error(
          body.error ||
            t(
              "Conferma non riuscita",
              "Confirmation failed",
              "Échec de la confirmation",
              "Error en la confirmación",
              "Bestätigung fehlgeschlagen",
            ),
        );
      }
      setNewEmail(body.email ?? "");
      setState("success");
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof Error
          ? err.message
          : t(
              "Conferma non riuscita",
              "Confirmation failed",
              "Échec de la confirmation",
              "Error en la confirmación",
              "Bestätigung fehlgeschlagen",
            ),
      );
    }
  }, [token, t]);

  return (
    <div className="min-h-screen w-full grid place-items-center px-6">
      <div className="surface-soft rounded-2xl p-8 max-w-md w-full text-center space-y-4">
        <h1 className="font-display text-2xl">
          {t("Conferma nuova email", "Confirm new email", "Confirmer le nouvel email", "Confirmar nuevo email", "Neue E-Mail bestätigen")}
        </h1>
        {state === "idle" ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t(
                "Clicca conferma per finalizzare il cambio email.",
                "Click confirm to finish changing your account email.",
                "Clique sur confirmer pour finaliser le changement d'email.",
                "Haz clic en confirmar para finalizar el cambio de email.",
                "Klicke auf bestätigen, um die E-Mail-Änderung abzuschließen.",
              )}
            </p>
            <Button className="w-full" onClick={() => void submit()}>
              {t("Conferma", "Confirm", "Confirmer", "Confirmar", "Bestätigen")}
            </Button>
          </>
        ) : null}
        {state === "loading" ? (
          <p className="text-sm text-muted-foreground">
            {t("Conferma in corso...", "Confirming...", "Confirmation en cours...", "Confirmando...", "Wird bestätigt...")}
          </p>
        ) : null}
        {state === "success" ? (
          <>
            <p className="text-sm">
              {t(
                "Email del tuo account aggiornata a",
                "Your account email is now",
                "L'email du compte est maintenant",
                "Tu email ahora es",
                "Deine Konto-E-Mail ist jetzt",
              )}{" "}
              <span className="font-medium">{newEmail}</span>.
            </p>
            <Button asChild className="w-full">
              <Link href="/auth">
                {t("Accedi", "Sign in", "Se connecter", "Iniciar sesión", "Anmelden")}
              </Link>
            </Button>
          </>
        ) : null}
        {state === "error" ? (
          <>
            <p className="text-sm text-destructive">{message}</p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">
                {t("Torna alla home", "Back to home", "Retour à l'accueil", "Volver al inicio", "Zurück zum Start")}
              </Link>
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
