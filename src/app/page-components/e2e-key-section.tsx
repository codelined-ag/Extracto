"use client";

import * as React from "react";
import { KeyRound, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface KeyStatus {
  enabled: boolean;
  fingerprint: string | null;
  registeredAt: string | null;
}

export function E2eKeySection({ t }: { t: Translator }) {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<KeyStatus | null>(null);
  const [pem, setPem] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/e2e/key");
      if (!res.ok) return;
      setStatus((await res.json()) as KeyStatus);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onSave = async () => {
    if (!pem.trim().startsWith("-----BEGIN PUBLIC KEY-----")) {
      toast({ title: t("Chiave RSA SPKI non valida", "Not a valid RSA SPKI key", "Clé RSA SPKI invalide", "Clave RSA SPKI no válida", "Ungültiger RSA-SPKI-Schlüssel"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/e2e/key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKeyPem: pem.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setPem("");
      await refresh();
      toast({ title: t("Chiave registrata", "Key registered", "Clé enregistrée", "Clave registrada", "Schlüssel registriert") });
    } catch (err) {
      toast({
        title: t("Registrazione fallita", "Register failed", "Échec de l'enregistrement", "Error al registrar", "Registrieren fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/e2e/key", { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      await refresh();
      toast({ title: t("Chiave rimossa", "Key removed", "Clé supprimée", "Clave eliminada", "Schlüssel entfernt") });
    } catch (err) {
      toast({
        title: t("Rimozione fallita", "Remove failed", "Échec de la suppression", "Error al eliminar", "Entfernen fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          {t("Cifratura end-to-end", "End-to-end encryption", "Chiffrement de bout en bout", "Cifrado de extremo a extremo", "Ende-zu-Ende-Verschlüsselung")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t(
            "Registra la tua chiave pubblica RSA SPKI: il server cifra le risposte di /api/v1/e2e/encrypt con quella chiave, così solo tu puoi decifrarle con la chiave privata.",
            "Register your RSA SPKI public key. The server seals responses from /api/v1/e2e/encrypt to that key so only you can open them with your private key.",
            "Enregistre ta clé publique RSA SPKI : le serveur scelle les réponses de /api/v1/e2e/encrypt avec cette clé, toi seul peux les ouvrir avec la clé privée.",
            "Registra tu clave pública RSA SPKI: el servidor sella las respuestas de /api/v1/e2e/encrypt con esa clave para que solo tú puedas abrirlas con tu clave privada.",
            "Registriere deinen öffentlichen RSA-SPKI-Schlüssel. Der Server versiegelt Antworten von /api/v1/e2e/encrypt mit diesem Schlüssel, sodass nur du sie mit deinem privaten Schlüssel öffnen kannst.",
          )}
        </p>
      </div>

      {status?.enabled ? (
        <div className="rounded-md border bg-secondary/30 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{t("attiva", "active", "active", "activa", "aktiv")}</Badge>
            <span className="text-xs font-mono truncate">{status.fingerprint}</span>
          </div>
          {status.registeredAt ? (
            <p className="text-[11px] text-muted-foreground">
              {t("Registrata", "Registered", "Enregistrée", "Registrada", "Registriert")}: {new Date(status.registeredAt).toLocaleString()}
            </p>
          ) : null}
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="ghost" onClick={() => void onDelete()} disabled={busy}>
              <Trash2 className="size-3.5 mr-1.5 text-destructive" />
              {t("Rimuovi chiave", "Remove key", "Supprimer la clé", "Quitar clave", "Schlüssel entfernen")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
          {t("Chiave pubblica RSA (PEM SPKI)", "RSA public key (PEM SPKI)", "Clé publique RSA (PEM SPKI)", "Clave pública RSA (PEM SPKI)", "Öffentlicher RSA-Schlüssel (PEM SPKI)")}
        </Label>
        <Textarea
          value={pem}
          onChange={(e) => setPem(e.target.value)}
          placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
          className="font-mono text-[11px] min-h-32"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void onSave()} disabled={busy || !pem.trim()}>
            {status?.enabled
              ? t("Sostituisci chiave", "Replace key", "Remplacer la clé", "Sustituir clave", "Schlüssel ersetzen")
              : t("Registra chiave", "Register key", "Enregistrer la clé", "Registrar clave", "Schlüssel registrieren")}
          </Button>
        </div>
      </div>
    </div>
  );
}
