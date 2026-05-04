"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

interface S3DefaultsForm {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  hasSecretAccessKey: boolean;
  prefix: string;
  forcePathStyle: boolean;
}

const EMPTY: S3DefaultsForm = {
  bucket: "",
  region: "us-east-1",
  endpoint: "",
  accessKeyId: "",
  secretAccessKey: "",
  hasSecretAccessKey: false,
  prefix: "extracto",
  forcePathStyle: false,
};

export interface S3SettingsSectionProps {
  t: Translator;
}

export function S3SettingsSection({ t }: S3SettingsSectionProps) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<S3DefaultsForm>(EMPTY);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [secretDirty, setSecretDirty] = React.useState(false);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch("/api/s3/defaults", { cache: "no-store" });
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      const data = (await r.json()) as Omit<S3DefaultsForm, "secretAccessKey">;
      setDraft({ ...EMPTY, ...data, secretAccessKey: "" });
      setSecretDirty(false);
    } catch (err) {
      toast({
        title: t(
          "Caricamento impostazioni S3 non riuscito",
          "S3 settings load failed",
          "Échec du chargement des paramètres S3",
          "Error al cargar la configuración de S3",
          "S3-Einstellungen laden fehlgeschlagen",
        ),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        bucket: draft.bucket,
        region: draft.region,
        endpoint: draft.endpoint,
        accessKeyId: draft.accessKeyId,
        prefix: draft.prefix,
        forcePathStyle: draft.forcePathStyle,
      };
      if (secretDirty) {
        payload.secretAccessKey = draft.secretAccessKey;
        payload.replaceSecretAccessKey = true;
      }
      const r = await fetch("/api/s3/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${r.status})`);
      }
      const data = (await r.json()) as Omit<S3DefaultsForm, "secretAccessKey">;
      setDraft({ ...EMPTY, ...data, secretAccessKey: "" });
      setSecretDirty(false);
      toast({
        title: t("Salvato", "Saved", "Enregistré", "Guardado", "Gespeichert"),
      });
    } catch (err) {
      toast({
        title: t(
          "Salvataggio non riuscito",
          "Save failed",
          "Échec de l'enregistrement",
          "Error al guardar",
          "Speichern fehlgeschlagen",
        ),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {t(
            "Esportazione S3",
            "S3 export",
            "Export S3",
            "Exportación S3",
            "S3-Export",
          )}
        </h3>
        <p className="text-xs text-muted-foreground/80">
          {t(
            "Configura un bucket S3 (AWS, R2, Backblaze, MinIO, ecc.) per inviarci i risultati. Le credenziali vengono memorizzate sul disco del server, mai esposte al browser.",
            "Configure an S3 bucket (AWS, R2, Backblaze, MinIO, etc.) to send results to. Credentials are stored on the server disk and never exposed to the browser.",
            "Configurez un bucket S3 (AWS, R2, Backblaze, MinIO, etc.) pour y envoyer les résultats. Les identifiants sont stockés sur le disque du serveur et ne sont jamais exposés au navigateur.",
            "Configura un bucket de S3 (AWS, R2, Backblaze, MinIO, etc.) para enviar resultados. Las credenciales se almacenan en el disco del servidor y nunca se exponen al navegador.",
            "Konfiguriere einen S3-Bucket (AWS, R2, Backblaze, MinIO, etc.) zum Senden von Ergebnissen. Anmeldedaten werden auf dem Server-Datenträger gespeichert und nie an den Browser weitergegeben.",
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
            {t("Bucket", "Bucket", "Bucket", "Bucket", "Bucket")}
          </Label>
          <Input
            value={draft.bucket}
            onChange={(e) => setDraft((p) => ({ ...p, bucket: e.target.value }))}
            placeholder="my-extracto-bucket"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
            {t("Regione", "Region", "Région", "Región", "Region")}
          </Label>
          <Input
            value={draft.region}
            onChange={(e) => setDraft((p) => ({ ...p, region: e.target.value }))}
            placeholder="us-east-1"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
          {t("Endpoint", "Endpoint", "Point de terminaison", "Endpoint", "Endpunkt")}{" "}
          <span className="text-muted-foreground/60">
            ({t("opzionale", "optional", "facultatif", "opcional", "optional")})
          </span>
        </Label>
        <Input
          value={draft.endpoint}
          onChange={(e) => setDraft((p) => ({ ...p, endpoint: e.target.value }))}
          placeholder="https://s3.amazonaws.com or https://<accountid>.r2.cloudflarestorage.com"
          disabled={isLoading}
        />
        <p className="text-[11px] text-muted-foreground/70">
          {t(
            "Lascia vuoto per AWS regionale. Specifica l'endpoint per R2, Backblaze, MinIO ecc.",
            "Leave empty for AWS regional. Specify endpoint for R2, Backblaze, MinIO, etc.",
            "Laisser vide pour AWS régional. Spécifiez l'endpoint pour R2, Backblaze, MinIO, etc.",
            "Déjalo vacío para AWS regional. Especifica el endpoint para R2, Backblaze, MinIO, etc.",
            "Für AWS regional leer lassen. Endpoint für R2, Backblaze, MinIO usw. angeben.",
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Access Key ID</Label>
          <Input
            value={draft.accessKeyId}
            onChange={(e) => setDraft((p) => ({ ...p, accessKeyId: e.target.value }))}
            placeholder="AKIA..."
            autoComplete="off"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Secret Access Key</Label>
          <Input
            type="password"
            value={draft.secretAccessKey}
            onChange={(e) => {
              setDraft((p) => ({ ...p, secretAccessKey: e.target.value }));
              setSecretDirty(true);
            }}
            placeholder={
              draft.hasSecretAccessKey && !secretDirty
                ? t("•••••• (salvata)", "•••••• (saved)", "•••••• (enregistré)", "•••••• (guardado)", "•••••• (gespeichert)")
                : ""
            }
            autoComplete="new-password"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
            {t("Prefisso chiavi", "Key prefix", "Préfixe de clé", "Prefijo de clave", "Schlüsselpräfix")}
          </Label>
          <Input
            value={draft.prefix}
            onChange={(e) => setDraft((p) => ({ ...p, prefix: e.target.value }))}
            placeholder="extracto"
            disabled={isLoading}
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5 flex-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Force path style</Label>
            <p className="text-[11px] text-muted-foreground/70">
              {t(
                "Necessario per MinIO e alcuni storage compatibili.",
                "Required for MinIO and some S3-compatible stores.",
                "Requis pour MinIO et certains stockages S3-compatibles.",
                "Necesario para MinIO y algunos almacenes compatibles con S3.",
                "Erforderlich für MinIO und einige S3-kompatible Speicher.",
              )}
            </p>
          </div>
          <Switch
            checked={draft.forcePathStyle}
            onCheckedChange={(checked) => setDraft((p) => ({ ...p, forcePathStyle: checked }))}
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={handleSave} disabled={isLoading || isSaving}>
          {isSaving
            ? t("Salvataggio...", "Saving...", "Enregistrement...", "Guardando...", "Speichere...")
            : t("Salva", "Save", "Enregistrer", "Guardar", "Speichern")}
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={isLoading || isSaving}>
          {t("Ricarica", "Reload", "Recharger", "Recargar", "Neu laden")}
        </Button>
      </div>
    </section>
  );
}
