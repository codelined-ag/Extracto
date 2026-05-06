"use client";

import * as React from "react";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface SessionInfo {
  email: string;
}

interface ChangeRequestResult {
  pendingEmail: string;
  expiresAt: string;
  mailDelivered: boolean;
  confirmUrl?: string;
}

interface TwoFactorStatus {
  totpEnabled: boolean;
}

export function EmailChangeSection({ t }: { t: Translator }) {
  const { toast } = useToast();
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [twoFactor, setTwoFactor] = React.useState<TwoFactorStatus | null>(null);
  const [newEmail, setNewEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ChangeRequestResult | null>(null);

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/auth/session", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/auth/2fa", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([s, f]) => {
      if (!active) return;
      setSession(s?.user ?? null);
      setTwoFactor(f ?? { totpEnabled: false });
    });
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newEmail,
          password,
          ...(twoFactor?.totpEnabled ? { code: code.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ChangeRequestResult> & { error?: string };
      if (!res.ok) throw new Error(body.error || `Email change failed (${res.status})`);
      setResult({
        pendingEmail: body.pendingEmail ?? newEmail,
        expiresAt: body.expiresAt ?? "",
        mailDelivered: body.mailDelivered === true,
        confirmUrl: body.confirmUrl,
      });
      setPassword("");
      setCode("");
    } catch (error) {
      toast({
        title: t("Cambio email non riuscito", "Email change failed", "Échec du changement", "Error al cambiar email", "E-Mail-Wechsel fehlgeschlagen"),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" />
        {t("Caricamento...", "Loading...", "Chargement...", "Cargando...", "Wird geladen...")}
      </div>
    );
  }

  if (result) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          {t("Email attuale", "Current email", "Email actuel", "Email actual", "Aktuelle E-Mail")}: <span className="font-medium">{session.email}</span>
        </p>
        <p>
          {t("In attesa di conferma", "Pending confirmation", "En attente de confirmation", "Pendiente de confirmación", "Bestätigung ausstehend")}: <span className="font-medium">{result.pendingEmail}</span>
        </p>
        {result.mailDelivered ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "Ti abbiamo mandato un link di conferma. Cliccaci entro 30 minuti per finalizzare il cambio.",
              "We sent a confirmation link. Click it within 30 minutes to finalize the change.",
              "Nous avons envoyé un lien de confirmation. Clique dessus dans les 30 minutes pour finaliser.",
              "Te enviamos un enlace de confirmación. Hazlo en 30 minutos para finalizar el cambio.",
              "Wir haben einen Bestätigungslink gesendet. Klicke ihn innerhalb von 30 Minuten an.",
            )}
          </p>
        ) : (
          <div className="surface-soft rounded-md p-3 text-xs space-y-1">
            <p>
              {t("SMTP non configurato sul server.", "SMTP isn't configured on this server.", "SMTP non configuré sur ce serveur.", "SMTP no configurado en este servidor.", "SMTP ist auf diesem Server nicht konfiguriert.")}
            </p>
            <p>
              {t(
                "Chiedi all'operatore di configurare SMTP, oppure contatta il proprietario del nuovo indirizzo per recuperare il link di conferma dai log del server.",
                "Ask the operator to configure SMTP, or contact the owner of the new address — the confirmation link is logged on the server.",
                "Demande à l'opérateur de configurer SMTP, ou demande au propriétaire de la nouvelle adresse de récupérer le lien dans les logs du serveur.",
                "Pídele al operador que configure SMTP o que el propietario de la nueva dirección recupere el enlace en los registros del servidor.",
                "Bitte den Operator, SMTP zu konfigurieren, oder lass den Inhaber der neuen Adresse den Link aus den Server-Logs abrufen.",
              )}
            </p>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => { setResult(null); setNewEmail(""); }}>
          {t("Cambia di nuovo", "Change again", "Changer à nouveau", "Cambiar de nuevo", "Erneut ändern")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p>
        {t("Email attuale", "Current email", "Email actuel", "Email actual", "Aktuelle E-Mail")}: <span className="font-medium">{session.email}</span>
      </p>
      <Input
        type="email"
        value={newEmail}
        onChange={(e) => setNewEmail(e.target.value)}
        placeholder={t("Nuova email", "New email", "Nouvel email", "Nuevo email", "Neue E-Mail")}
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("Password attuale", "Current password", "Mot de passe actuel", "Contraseña actual", "Aktuelles Passwort")}
      />
      {twoFactor?.totpEnabled ? (
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          maxLength={32}
          placeholder={t("Codice 2FA", "2FA code", "Code 2FA", "Código 2FA", "2FA-Code")}
          className="font-mono"
        />
      ) : null}
      <Button
        size="sm"
        onClick={() => void submit()}
        disabled={
          busy ||
          !newEmail ||
          !password ||
          (twoFactor?.totpEnabled === true && code.trim().length < 6)
        }
      >
        <Mail className="size-3 mr-1" />
        {t("Invia conferma", "Send confirmation", "Envoyer confirmation", "Enviar confirmación", "Bestätigung senden")}
      </Button>
    </div>
  );
}
