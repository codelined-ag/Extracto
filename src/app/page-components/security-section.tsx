"use client";

import * as React from "react";
import { Check, Loader2, ShieldCheck, ShieldAlert, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface TwoFactorStatus {
  totpEnabled: boolean;
  hasPendingSecret: boolean;
  recoveryCodesRemaining: number;
}

interface EnrollmentPayload {
  qrPngDataUrl: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

export function SecuritySection({ t }: { t: Translator }) {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<TwoFactorStatus | null>(null);
  const [enrollment, setEnrollment] = React.useState<EnrollmentPayload | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [disablePassword, setDisablePassword] = React.useState("");
  const [disableCode, setDisableCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/2fa", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as TwoFactorStatus;
      setStatus(data);
    } catch {
      void 0;
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const beginEnrollment = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: status?.hasPendingSecret === true }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<EnrollmentPayload> & { error?: string };
      if (!res.ok) throw new Error(body.error || `Setup failed (${res.status})`);
      setEnrollment({
        qrPngDataUrl: body.qrPngDataUrl ?? "",
        otpauthUrl: body.otpauthUrl ?? "",
        recoveryCodes: body.recoveryCodes ?? [],
      });
      setVerifyCode("");
    } catch (error) {
      toast({
        title: t("Avvio 2FA non riuscito", "2FA setup failed", "Échec configuration 2FA", "Error al iniciar 2FA", "2FA-Setup fehlgeschlagen"),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrollment = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `Verification failed (${res.status})`);
      setEnrollment(null);
      setVerifyCode("");
      toast({
        title: t("2FA attiva", "2FA enabled", "2FA activée", "2FA activado", "2FA aktiviert"),
      });
      await reload();
    } catch (error) {
      toast({
        title: t("Codice non valido", "Invalid code", "Code invalide", "Código no válido", "Code ungültig"),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword, code: disableCode.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `Disable failed (${res.status})`);
      setDisablePassword("");
      setDisableCode("");
      toast({
        title: t("2FA disattivata", "2FA disabled", "2FA désactivée", "2FA desactivado", "2FA deaktiviert"),
      });
      await reload();
    } catch (error) {
      toast({
        title: t("Disattivazione non riuscita", "Could not disable 2FA", "Désactivation impossible", "No se pudo desactivar", "Deaktivierung fehlgeschlagen"),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const downloadRecoveryCodes = () => {
    if (!enrollment) return;
    const blob = new Blob([enrollment.recoveryCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extracto-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!status) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" />
        {t("Caricamento stato 2FA...", "Loading 2FA status...", "Chargement du statut 2FA...", "Cargando estado 2FA...", "2FA-Status wird geladen...")}
      </div>
    );
  }

  if (enrollment) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t(
            "Scansiona il QR con la tua app authenticator (Google Authenticator, 1Password, Authy...). Salva i codici di recupero in un posto sicuro: ti permettono di accedere se perdi il telefono.",
            "Scan the QR with your authenticator app (Google Authenticator, 1Password, Authy...). Save the recovery codes somewhere safe; they let you sign in if you lose your phone.",
            "Scanne le QR avec ton application d'authentification. Conserve les codes de récupération en lieu sûr ; ils te permettent de te connecter si tu perds ton téléphone.",
            "Escanea el QR con tu app de autenticación. Guarda los códigos de recuperación en un lugar seguro; te permiten iniciar sesión si pierdes el teléfono.",
            "Scanne den QR mit deiner Authenticator-App. Bewahre die Wiederherstellungscodes sicher auf; damit kommst du rein, wenn du dein Handy verlierst.",
          )}
        </p>
        <img src={enrollment.qrPngDataUrl} alt="2FA QR" className="w-44 h-44 bg-white rounded-md border" />
        <div className="text-[11px] font-mono break-all text-muted-foreground">
          {enrollment.otpauthUrl}
        </div>
        <div className="surface-soft rounded-md p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {t("Codici di recupero", "Recovery codes", "Codes de récupération", "Códigos de recuperación", "Wiederherstellungscodes")}
            </span>
            <Button variant="ghost" size="sm" className="h-7" onClick={downloadRecoveryCodes}>
              <Download className="size-3 mr-1" />
              {t("Scarica", "Download", "Télécharger", "Descargar", "Herunterladen")}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {enrollment.recoveryCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            {t("Inserisci il codice a 6 cifre per confermare", "Enter the 6-digit code to confirm", "Saisis le code à 6 chiffres pour confirmer", "Introduce el código de 6 dígitos para confirmar", "6-stelligen Code zur Bestätigung eingeben")}
          </label>
          <Input
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            className="font-mono tracking-widest text-center"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEnrollment(null)} disabled={busy}>
            {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
          </Button>
          <Button size="sm" onClick={() => void confirmEnrollment()} disabled={busy || verifyCode.trim().length < 6}>
            <Check className="size-3 mr-1" />
            {t("Attiva 2FA", "Enable 2FA", "Activer 2FA", "Activar 2FA", "2FA aktivieren")}
          </Button>
        </div>
      </div>
    );
  }

  if (status.totpEnabled) {
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-4" />
          {t("2FA attiva", "2FA is enabled", "2FA est activée", "2FA está activado", "2FA ist aktiv")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            `Hai ${status.recoveryCodesRemaining} codici di recupero non usati.`,
            `${status.recoveryCodesRemaining} unused recovery codes remaining.`,
            `${status.recoveryCodesRemaining} codes de récupération non utilisés.`,
            `Quedan ${status.recoveryCodesRemaining} códigos de recuperación sin usar.`,
            `${status.recoveryCodesRemaining} ungenutzte Wiederherstellungscodes übrig.`,
          )}
        </p>
        <div className="surface-soft rounded-md p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("Disattiva 2FA", "Disable 2FA", "Désactiver 2FA", "Desactivar 2FA", "2FA deaktivieren")}
          </p>
          <Input
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            placeholder={t("Password attuale", "Current password", "Mot de passe actuel", "Contraseña actual", "Aktuelles Passwort")}
            className="text-xs"
          />
          <Input
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            inputMode="numeric"
            maxLength={32}
            placeholder={t("Codice 2FA o di recupero", "2FA or recovery code", "Code 2FA ou de récupération", "Código 2FA o de recuperación", "2FA- oder Wiederherstellungscode")}
            className="font-mono text-xs"
          />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void disable2fa()}
            disabled={busy || !disablePassword || disableCode.trim().length < 6}
          >
            {t("Disattiva", "Disable", "Désactiver", "Desactivar", "Deaktivieren")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <ShieldAlert className="size-4" />
        {t("2FA non attiva", "2FA is not enabled", "2FA non activée", "2FA no activado", "2FA ist nicht aktiv")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Aggiungi un secondo fattore (TOTP) all'accesso. Funziona con Google Authenticator, 1Password, Authy.",
          "Add a second factor (TOTP) to sign-in. Works with Google Authenticator, 1Password, Authy.",
          "Ajoute un second facteur (TOTP). Fonctionne avec Google Authenticator, 1Password, Authy.",
          "Añade un segundo factor (TOTP) al inicio de sesión. Funciona con Google Authenticator, 1Password, Authy.",
          "Füge einen zweiten Faktor (TOTP) zur Anmeldung hinzu. Funktioniert mit Google Authenticator, 1Password, Authy.",
        )}
      </p>
      <Button size="sm" onClick={() => void beginEnrollment()} disabled={busy}>
        {busy ? <Loader2 className="size-3 animate-spin mr-1" /> : <ShieldCheck className="size-3 mr-1" />}
        {t("Attiva la 2FA", "Enable 2FA", "Activer 2FA", "Activar 2FA", "2FA aktivieren")}
      </Button>
    </div>
  );
}
