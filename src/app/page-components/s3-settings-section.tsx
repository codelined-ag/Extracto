"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";
import { HintLabel } from "@/app/page-components/field-hint";

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
          <HintLabel hint={t("Il nome del bucket S3 (o R2 / MinIO / Backblaze) dove Extracto carica i risultati o legge gli ingressi.","The S3 (or R2 / MinIO / Backblaze) bucket name where Extracto uploads results or reads inputs.","Le nom du bucket S3 (ou R2 / MinIO / Backblaze) où Extracto téléverse les résultats ou lit les entrées.","El nombre del bucket S3 (o R2 / MinIO / Backblaze) donde Extracto sube resultados o lee entradas.","Der S3- (oder R2- / MinIO- / Backblaze-) Bucket-Name, in den Extracto Ergebnisse hochlädt oder Eingaben liest.")}>
            {t("Bucket", "Bucket", "Bucket", "Bucket", "Bucket")}
          </HintLabel>
          <Input
            value={draft.bucket}
            onChange={(e) => setDraft((p) => ({ ...p, bucket: e.target.value }))}
            placeholder="my-extracto-bucket"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1.5">
          <HintLabel hint={t("Regione AWS del bucket. Per S3-compatibili (R2, MinIO, Backblaze) puoi mettere 'auto' o lasciare il default; conta solo l'endpoint.","AWS region of the bucket. For S3-compatible providers (R2, MinIO, Backblaze) you can use 'auto' or leave the default; only the endpoint matters.","Région AWS du bucket. Pour les fournisseurs S3-compatibles (R2, MinIO, Backblaze), utilisez 'auto' ou laissez la valeur par défaut ; seul l'endpoint compte.","Región AWS del bucket. Para proveedores S3-compatibles (R2, MinIO, Backblaze) puedes usar 'auto' o dejar el valor por defecto; solo cuenta el endpoint.","AWS-Region des Buckets. Bei S3-kompatiblen Anbietern (R2, MinIO, Backblaze) reicht 'auto' oder der Standard; nur der Endpunkt zählt.")}>
            {t("Regione", "Region", "Région", "Región", "Region")}
          </HintLabel>
          <Input
            value={draft.region}
            onChange={(e) => setDraft((p) => ({ ...p, region: e.target.value }))}
            placeholder="us-east-1"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <HintLabel hint={t("URL HTTP del provider S3. Lascia vuoto per AWS regionale; obbligatorio per R2 (https://<account>.r2.cloudflarestorage.com), MinIO, Backblaze, Wasabi, ecc.","HTTP URL of the S3 provider. Leave empty for AWS regional; required for R2 (https://<account>.r2.cloudflarestorage.com), MinIO, Backblaze, Wasabi, and the like.","URL HTTP du fournisseur S3. Laisser vide pour AWS régional ; requis pour R2, MinIO, Backblaze, Wasabi, etc.","URL HTTP del proveedor S3. Déjala vacía para AWS regional; requerida para R2, MinIO, Backblaze, Wasabi, etc.","HTTP-URL des S3-Anbieters. Für AWS regional leer lassen; erforderlich für R2, MinIO, Backblaze, Wasabi usw.")}>
          {t("Endpoint", "Endpoint", "Point de terminaison", "Endpoint", "Endpunkt")}{" "}
          <span className="text-muted-foreground/60">
            ({t("opzionale", "optional", "facultatif", "opcional", "optional")})
          </span>
        </HintLabel>
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
          <HintLabel hint={t("ID della coppia di credenziali IAM con accesso al bucket. Memorizzato cifrato sul disco; mai inviato al browser.","ID of the IAM credential pair with access to the bucket. Stored encrypted on disk; never sent back to the browser.","ID de la paire de credentials IAM avec accès au bucket. Stocké chiffré sur le disque ; jamais renvoyé au navigateur.","ID del par de credenciales IAM con acceso al bucket. Se almacena cifrado en disco; nunca se envía al navegador.","ID des IAM-Credential-Paars mit Zugriff auf den Bucket. Verschlüsselt gespeichert; nie an den Browser zurückgesendet.")}>Access Key ID</HintLabel>
          <Input
            value={draft.accessKeyId}
            onChange={(e) => setDraft((p) => ({ ...p, accessKeyId: e.target.value }))}
            placeholder="AKIA..."
            autoComplete="off"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1.5">
          <HintLabel hint={t("Secret della coppia di credenziali IAM. Cifrato a riposo con AUTH_SECRET; il browser non lo riceve indietro.","Secret of the IAM credential pair. Encrypted at rest with AUTH_SECRET; the browser never gets it back.","Secret de la paire de credentials IAM. Chiffré au repos avec AUTH_SECRET ; le navigateur ne le reçoit jamais.","Secret del par de credenciales IAM. Cifrado en reposo con AUTH_SECRET; el navegador nunca lo recibe.","Secret des IAM-Credential-Paars. Mit AUTH_SECRET verschlüsselt gespeichert; der Browser bekommt es nie zurück.")}>Secret Access Key</HintLabel>
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
          <HintLabel hint={t("Cartella virtuale dentro il bucket. Tutte le chiavi caricate o lette saranno sotto questo prefisso. Lascia vuoto per la radice.","Virtual folder inside the bucket. Every key Extracto uploads or reads is scoped under this prefix. Leave empty for the bucket root.","Dossier virtuel dans le bucket. Toutes les clés écrites ou lues sont sous ce préfixe. Laisser vide pour la racine.","Carpeta virtual dentro del bucket. Cualquier clave que Extracto suba o lea se ubica bajo este prefijo. Déjalo vacío para la raíz.","Virtueller Ordner im Bucket. Alle hochgeladenen oder gelesenen Keys liegen unter diesem Präfix. Leer lassen für den Bucket-Root.")}>
            {t("Prefisso chiavi", "Key prefix", "Préfixe de clé", "Prefijo de clave", "Schlüsselpräfix")}
          </HintLabel>
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
