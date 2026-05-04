"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, LoaderCircleIcon, TrashIcon, AlertTriangleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

import { SettingsSection } from "@/app/page-components/settings-section";
import type { Translator } from "@/app/page-components/types";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
  totalRequests: number;
  requestsThisMonth: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface KeysListResponse {
  keys: ApiKeyRow[];
  availableScopes: string[];
}

interface KeyCreateResponse {
  key: ApiKeyRow & { plaintext: string };
  warning: string;
}

const MAX_RATE_LIMIT = 600;
const MAX_NAME = 64;
const MAX_KEYS_PER_USER = 20;
const SCOPE_HINTS: Record<string, [string, string, string, string, string]> = {
  "*": [
    "Tutto: ogni endpoint v1.",
    "Everything: every v1 endpoint.",
    "Tout : tous les endpoints v1.",
    "Todo: cualquier endpoint v1.",
    "Alles: jeder v1-Endpunkt.",
  ],
  "ocr:submit": [
    "Inviare nuovi job OCR.",
    "Submit new OCR jobs.",
    "Soumettre de nouveaux jobs OCR.",
    "Enviar nuevos trabajos OCR.",
    "Neue OCR-Jobs einreichen.",
  ],
  "ocr:read": [
    "Leggere job e risultati.",
    "Read jobs and results.",
    "Lire les jobs et résultats.",
    "Leer trabajos y resultados.",
    "Jobs und Ergebnisse lesen.",
  ],
  "ocr:control": [
    "Fermare o cancellare job.",
    "Stop or delete jobs.",
    "Arrêter ou supprimer des jobs.",
    "Detener o eliminar trabajos.",
    "Jobs stoppen oder löschen.",
  ],
  "settings:read": [
    "Leggere le impostazioni utente.",
    "Read user settings.",
    "Lire les paramètres utilisateur.",
    "Leer la configuración del usuario.",
    "Benutzereinstellungen lesen.",
  ],
  "settings:write": [
    "Modificare le impostazioni utente.",
    "Modify user settings.",
    "Modifier les paramètres utilisateur.",
    "Modificar la configuración del usuario.",
    "Benutzereinstellungen ändern.",
  ],
  "webhooks:read": [
    "Leggere i webhook.",
    "Read webhooks.",
    "Lire les webhooks.",
    "Leer webhooks.",
    "Webhooks lesen.",
  ],
  "webhooks:write": [
    "Creare e modificare i webhook.",
    "Create and modify webhooks.",
    "Créer et modifier des webhooks.",
    "Crear y modificar webhooks.",
    "Webhooks erstellen und ändern.",
  ],
  "presets:read": [
    "Leggere i preset di output.",
    "Read output presets.",
    "Lire les presets de sortie.",
    "Leer presets de salida.",
    "Output-Presets lesen.",
  ],
  "presets:write": [
    "Creare e modificare i preset.",
    "Create and modify presets.",
    "Créer et modifier des presets.",
    "Crear y modificar presets.",
    "Presets erstellen und ändern.",
  ],
  "search:read": [
    "Cercare nei risultati estratti.",
    "Search across extracted results.",
    "Rechercher dans les résultats extraits.",
    "Buscar en los resultados extraídos.",
    "In extrahierten Ergebnissen suchen.",
  ],
  "kb:write": [
    "Esportare verso un vector store.",
    "Export to a vector store.",
    "Exporter vers un vector store.",
    "Exportar a un vector store.",
    "In einen Vektor-Store exportieren.",
  ],
  "s3:read": [
    "Sfogliare e importare oggetti da S3.",
    "Browse and import objects from S3.",
    "Parcourir et importer des objets depuis S3.",
    "Explorar e importar objetos desde S3.",
    "Objekte aus S3 durchsuchen und importieren.",
  ],
  "s3:write": [
    "Esportare i risultati verso un bucket S3.",
    "Export results to an S3 bucket.",
    "Exporter les résultats vers un bucket S3.",
    "Exportar resultados a un bucket de S3.",
    "Ergebnisse in einen S3-Bucket exportieren.",
  ],
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export interface ApiKeysSectionProps {
  t: Translator;
}

export function ApiKeysSection({ t }: ApiKeysSectionProps) {
  const { toast } = useToast();
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [availableScopes, setAvailableScopes] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [selectedScopes, setSelectedScopes] = React.useState<Set<string>>(() => new Set(["*"]));
  const [rateLimit, setRateLimit] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [createdKey, setCreatedKey] = React.useState<{ plaintext: string; name: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState<{ id: string; name: string } | null>(null);

  const loadKeys = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as KeysListResponse;
      setKeys(payload.keys || []);
      setAvailableScopes(payload.availableScopes || []);
    } catch (error) {
      toast({
        title: t(
          "Caricamento chiavi non riuscito",
          "Couldn't load API keys",
          "Échec du chargement des clés",
          "No se pudieron cargar las claves",
          "Schlüssel laden fehlgeschlagen",
        ),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, t]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadKeys();
  }, [loadKeys]);

  const wildcardSelected = selectedScopes.has("*");

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (scope === "*") {
        if (next.has("*")) {
          next.delete("*");
        } else {
          next.clear();
          next.add("*");
        }
        return next;
      }
      next.delete("*");
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreating) return;
    if (!name.trim()) {
      toast({
        title: t(
          "Nome richiesto",
          "Name required",
          "Nom requis",
          "Nombre obligatorio",
          "Name erforderlich",
        ),
        variant: "destructive",
      });
      return;
    }
    setIsCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        scopes: Array.from(selectedScopes),
      };
      const rateNum = Number(rateLimit);
      if (rateLimit.trim() && Number.isFinite(rateNum) && rateNum > 0) {
        body.rateLimitPerMinute = Math.trunc(rateNum);
      }
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          data?.error ||
            t(
              "Creazione chiave fallita",
              "Key creation failed",
              "Échec de la création de clé",
              "Error al crear la clave",
              "Schlüsselerstellung fehlgeschlagen",
            ),
        );
      }
      const payload = (await res.json()) as KeyCreateResponse;
      setCreatedKey({ plaintext: payload.key.plaintext, name: payload.key.name });
      await loadKeys();
    } catch (error) {
      toast({
        title: t(
          "Creazione chiave fallita",
          "Key creation failed",
          "Échec de la création de clé",
          "Error al crear la clave",
          "Schlüsselerstellung fehlgeschlagen",
        ),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!confirmRevoke) return;
    const target = confirmRevoke;
    setRevokingId(target.id);
    try {
      const res = await fetch(`/api/v1/keys/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      toast({
        title: t("Chiave revocata", "Key revoked", "Clé révoquée", "Clave revocada", "Schlüssel widerrufen"),
      });
      await loadKeys();
    } catch (error) {
      toast({
        title: t(
          "Revoca non riuscita",
          "Revoke failed",
          "Échec de la révocation",
          "Error al revocar",
          "Widerruf fehlgeschlagen",
        ),
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
    } finally {
      setRevokingId(null);
      setConfirmRevoke(null);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.plaintext);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: t(
          "Copia non riuscita",
          "Copy failed",
          "Échec de la copie",
          "Error al copiar",
          "Kopieren fehlgeschlagen",
        ),
        variant: "destructive",
      });
    }
  };

  const dismissCreatedKey = () => {
    setCreatedKey(null);
    setCopied(false);
    setName("");
    setSelectedScopes(new Set(["*"]));
    setRateLimit("");
  };

  const scopeHint = (scope: string) => {
    const entry = SCOPE_HINTS[scope];
    if (!entry) return scope;
    return t(entry[0], entry[1], entry[2], entry[3], entry[4]);
  };

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-5">
      <SettingsSection
        title={t("Crea una chiave", "Create a key", "Créer une clé", "Crear una clave", "Schlüssel erstellen")}
        hint={t(
          "Le chiavi API si autenticano via header Authorization: Bearer. Mostrate una sola volta dopo la creazione.",
          "API keys authenticate via the Authorization: Bearer header. Shown exactly once after creation.",
          "Les clés API s'authentifient via l'en-tête Authorization: Bearer. Affichées une seule fois après création.",
          "Las claves API se autentican mediante el encabezado Authorization: Bearer. Se muestran una sola vez tras crearlas.",
          "API-Schlüssel authentifizieren sich per Authorization: Bearer. Werden nach der Erstellung nur einmal angezeigt.",
        )}
      >
        {createdKey ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangleIcon size={16} className="text-amber-500" />
              {t(
                "Questa è l'unica volta che vedrai la chiave",
                "This is the only time you'll see the key",
                "C'est la seule fois où tu verras la clé",
                "Esta es la única vez que verás la clave",
                "Dies ist die einzige Anzeige des Schlüssels",
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Copiala ora e conservala in modo sicuro. Non potrà essere recuperata.",
                "Copy it now and store it somewhere safe. It can't be recovered later.",
                "Copie-la maintenant et conserve-la en lieu sûr. Elle ne pourra pas être récupérée.",
                "Cópiala ahora y guárdala en un lugar seguro. No podrá recuperarse después.",
                "Kopiere ihn jetzt und bewahre ihn sicher auf. Er kann später nicht wiederhergestellt werden.",
              )}
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={createdKey.plaintext}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant={copied ? "outline" : "default"} onClick={copyKey}>
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                <span className="ml-1.5">
                  {copied
                    ? t("Copiata", "Copied", "Copiée", "Copiada", "Kopiert")
                    : t("Copia", "Copy", "Copier", "Copiar", "Kopieren")}
                </span>
              </Button>
            </div>
            <Button type="button" variant={copied ? "default" : "outline"} size="sm" onClick={dismissCreatedKey}>
              {t("Ho salvato la chiave", "I've saved the key", "J'ai sauvegardé la clé", "Guardé la clave", "Ich habe den Schlüssel gespeichert")}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="apikey-name" className="text-xs uppercase tracking-wider text-muted-foreground/80">
                {t("Nome", "Name", "Nom", "Nombre", "Name")}
              </Label>
              <Input
                id="apikey-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME}
                disabled={isCreating}
                placeholder={t(
                  "es. ci-runner",
                  "e.g. ci-runner",
                  "ex. ci-runner",
                  "ej. ci-runner",
                  "z. B. ci-runner",
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
                {t("Permessi", "Scopes", "Permissions", "Permisos", "Berechtigungen")}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleScope("*")}
                      disabled={isCreating}
                      aria-pressed={wildcardSelected}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                        wildcardSelected
                          ? "bg-primary text-primary-foreground"
                          : "border border-border/60 bg-background text-foreground/80 hover:bg-secondary"
                      }`}
                    >
                      *
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{scopeHint("*")}</TooltipContent>
                </Tooltip>
                {availableScopes.map((scope) => {
                  const selected = selectedScopes.has(scope);
                  return (
                    <Tooltip key={scope}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => toggleScope(scope)}
                          disabled={isCreating || wildcardSelected}
                          aria-pressed={selected}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "border border-border/60 bg-background text-foreground/80 hover:bg-secondary"
                          }`}
                        >
                          {scope}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{scopeHint(scope)}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {wildcardSelected
                  ? scopeHint("*")
                  : selectedScopes.size > 0
                    ? t(
                        "Solo i permessi selezionati saranno concessi.",
                        "Only the selected scopes will be granted.",
                        "Seules les permissions sélectionnées seront accordées.",
                        "Solo se otorgarán los permisos seleccionados.",
                        "Nur die ausgewählten Berechtigungen werden gewährt.",
                      )
                    : t(
                        "Selezione vuota: il backend assegna ogni permesso.",
                        "Empty selection: the backend grants every scope.",
                        "Sélection vide : le backend accorde toutes les permissions.",
                        "Selección vacía: el backend otorga todos los permisos.",
                        "Leere Auswahl: das Backend vergibt alle Berechtigungen.",
                      )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apikey-rate" className="text-xs uppercase tracking-wider text-muted-foreground/80">
                {t("Limite (richieste/min)", "Rate limit (req/min)", "Limite (req/min)", "Límite (sol/min)", "Limit (Anfragen/Min)")}
              </Label>
              <Input
                id="apikey-rate"
                type="number"
                min={1}
                max={MAX_RATE_LIMIT}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                disabled={isCreating}
                placeholder={t(
                  "Lascia vuoto per il default",
                  "Leave empty for the default",
                  "Laisser vide pour la valeur par défaut",
                  "Déjalo vacío para el valor por defecto",
                  "Leer lassen für den Standard",
                )}
              />
            </div>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? <LoaderCircleIcon size={14} className="animate-spin mr-1.5" /> : null}
              {t("Crea chiave", "Create key", "Créer la clé", "Crear clave", "Schlüssel erstellen")}
            </Button>
          </form>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("Chiavi attive", "Active keys", "Clés actives", "Claves activas", "Aktive Schlüssel")}
        right={
          <span className="text-[11px] text-muted-foreground/70">
            {activeKeys.length} / {MAX_KEYS_PER_USER}
          </span>
        }
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon size={14} className="animate-spin" />
            {t("Caricamento...", "Loading...", "Chargement...", "Cargando...", "Wird geladen...")}
          </div>
        ) : activeKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              "Nessuna chiave attiva. Creane una sopra per iniziare a chiamare /api/v1/...",
              "No active keys yet. Create one above to start calling /api/v1/...",
              "Aucune clé active. Créez-en une ci-dessus pour commencer à appeler /api/v1/...",
              "Sin claves activas. Crea una arriba para empezar a llamar a /api/v1/...",
              "Noch keine aktiven Schlüssel. Erstelle oben einen, um /api/v1/... aufzurufen.",
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {activeKeys.map((key) => (
              <li key={key.id} className="rounded-xl border border-border/40 bg-secondary/30 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{key.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground/80 truncate">
                      {key.prefix}••••
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRevoke({ id: key.id, name: key.name })}
                    disabled={revokingId === key.id}
                    className="text-destructive hover:text-destructive"
                    aria-label={t("Revoca", "Revoke", "Révoquer", "Revocar", "Widerrufen")}
                  >
                    {revokingId === key.id ? (
                      <LoaderCircleIcon size={14} className="animate-spin" />
                    ) : (
                      <TrashIcon size={14} />
                    )}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {key.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="font-mono text-[10px]">
                      {scope}
                    </Badge>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground/80">
                  <div>
                    <span className="text-muted-foreground/60">
                      {t("Limite:", "Rate limit:", "Limite :", "Límite:", "Limit:")}
                    </span>{" "}
                    {key.rateLimitPerMinute ?? t("default", "default", "défaut", "predeterminado", "Standard")}
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">
                      {t("Richieste:", "Requests:", "Requêtes :", "Solicitudes:", "Anfragen:")}
                    </span>{" "}
                    {key.totalRequests}
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">
                      {t("Creata:", "Created:", "Créée :", "Creada:", "Erstellt:")}
                    </span>{" "}
                    {formatDate(key.createdAt)}
                  </div>
                  <div>
                    <span className="text-muted-foreground/60">
                      {t("Ultimo uso:", "Last used:", "Dernier usage :", "Último uso:", "Zuletzt verwendet:")}
                    </span>{" "}
                    {formatDate(key.lastUsedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {revokedKeys.length > 0 ? (
        <SettingsSection
          title={t(
            "Revocate",
            "Revoked",
            "Révoquées",
            "Revocadas",
            "Widerrufen",
          )}
        >
          <ul className="space-y-1.5">
            {revokedKeys.map((key) => (
              <li
                key={key.id}
                className="rounded-lg border border-border/30 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground/80 flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  <span className="font-medium text-foreground/70">{key.name}</span>{" "}
                  <span className="font-mono text-muted-foreground/60">{key.prefix}••••</span>
                </span>
                <span className="text-[11px] text-muted-foreground/60 shrink-0">
                  {formatDate(key.revokedAt)}
                </span>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <Dialog open={confirmRevoke !== null} onOpenChange={(open) => { if (!open && !revokingId) setConfirmRevoke(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {t(
                "Revocare la chiave?",
                "Revoke the key?",
                "Révoquer la clé ?",
                "¿Revocar la clave?",
                "Schlüssel widerrufen?",
              )}
            </DialogTitle>
            <DialogDescription>
              {confirmRevoke
                ? t(
                    `"${confirmRevoke.name}" non potrà più essere usata. Ogni richiesta futura con questa chiave verrà rifiutata.`,
                    `"${confirmRevoke.name}" will stop working immediately. Future requests using this key will be rejected.`,
                    `"${confirmRevoke.name}" cessera de fonctionner immédiatement. Les futures requêtes avec cette clé seront rejetées.`,
                    `"${confirmRevoke.name}" dejará de funcionar de inmediato. Las futuras solicitudes con esta clave serán rechazadas.`,
                    `"${confirmRevoke.name}" hört sofort auf zu funktionieren. Künftige Anfragen mit diesem Schlüssel werden abgelehnt.`,
                  )
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmRevoke(null)}
              disabled={revokingId !== null}
            >
              {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmRevoke}
              disabled={revokingId !== null}
            >
              {revokingId !== null ? <LoaderCircleIcon size={14} className="animate-spin mr-1.5" /> : null}
              {t("Revoca", "Revoke", "Révoquer", "Revocar", "Widerrufen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
