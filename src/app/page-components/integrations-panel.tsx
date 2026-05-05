"use client";

import * as React from "react";
import { Cloud, Folder, Plug, Trash2, Plus, Pause, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { FolderPickerDialog } from "@/app/page-components/folder-picker-dialog";
import type { Translator } from "@/app/page-components/types";

export type CloudProvider = "dropbox" | "google_drive" | "onedrive";
export type WatcherProvider = CloudProvider | "local";

const PROVIDERS: ReadonlyArray<{ id: CloudProvider; label: string }> = [
  { id: "dropbox", label: "Dropbox" },
  { id: "google_drive", label: "Google Drive" },
  { id: "onedrive", label: "OneDrive" },
];

const WATCHER_OPTIONS: ReadonlyArray<{ id: WatcherProvider; label: string }> = [
  ...PROVIDERS,
  { id: "local", label: "Local folder" },
];

interface ConnectionStatus {
  provider: string;
  accountLabel: string;
  clientIdLast4: string;
  createdAt: string;
  updatedAt: string;
}

interface StatusResponse {
  available: Record<CloudProvider, boolean>;
  oauthApp: Record<CloudProvider, { source: "user" | "server" | "none"; clientIdLast4: string | null }>;
  connections: ConnectionStatus[];
}

interface Watcher {
  id: string;
  provider: string;
  name: string;
  folderPath: string;
  intervalSeconds: number;
  active: boolean;
  model: string;
  lastPolledAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  ingestedCount?: number;
}

export function IntegrationsPanel({ t }: { t: Translator }) {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [watchers, setWatchers] = React.useState<Watcher[]>([]);
  const [busyProvider, setBusyProvider] = React.useState<CloudProvider | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        fetch("/api/integrations").then((r) => (r.ok ? r.json() : Promise.reject(r))),
        fetch("/api/integrations/watchers").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      ]);
      setStatus(s as StatusResponse);
      setWatchers(((w as { watchers: Watcher[] }).watchers) || []);
    } catch {
      toast({
        title: t("Caricamento integrazioni fallito", "Failed to load integrations", "Échec du chargement des intégrations", "Error al cargar integraciones", "Integrationen konnten nicht geladen werden"),
        variant: "destructive",
      });
    }
  }, [toast, t]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const connectedSet = React.useMemo(
    () => new Set((status?.connections ?? []).map((c) => c.provider)),
    [status],
  );

  const onConnect = async (provider: CloudProvider) => {
    setBusyProvider(provider);
    try {
      const res = await fetch(`/api/integrations/${provider}/start`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { authUrl?: string; error?: string };
      if (!res.ok || !json.authUrl) throw new Error(json.error || `Connect failed (${res.status})`);
      // eslint-disable-next-line react-hooks/immutability
      window.location.href = json.authUrl;
    } catch (err) {
      toast({
        title: t("Connessione fallita", "Connect failed", "Échec de la connexion", "Conexión fallida", "Verbindung fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyProvider(null);
    }
  };

  const onDisconnect = async (provider: CloudProvider) => {
    setBusyProvider(provider);
    try {
      const res = await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `Disconnect failed (${res.status})`);
      }
      await refresh();
      toast({ title: t("Disconnesso", "Disconnected", "Déconnecté", "Desconectado", "Getrennt") });
    } catch (err) {
      toast({
        title: t("Disconnessione fallita", "Disconnect failed", "Échec de la déconnexion", "Error al desconectar", "Trennen fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">
          {t("Connessioni", "Connections", "Connexions", "Conexiones", "Verbindungen")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t(
            "Collega un account cloud per importare file e inviare i risultati.",
            "Link a cloud account to import files and push results.",
            "Connectez un compte cloud pour importer des fichiers et pousser des résultats.",
            "Vincula una cuenta en la nube para importar archivos y enviar resultados.",
            "Verbinde ein Cloud-Konto, um Dateien zu importieren und Ergebnisse zu senden.",
          )}
        </p>
      </div>
      <div className="grid gap-2">
        {PROVIDERS.map((p) => {
          const oauthApp = status?.oauthApp?.[p.id];
          const available = oauthApp ? oauthApp.source !== "none" : status?.available?.[p.id];
          const connection = status?.connections?.find((c) => c.provider === p.id);
          const connected = connectedSet.has(p.id);
          return (
            <Card key={p.id}>
              <CardContent className="p-3 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Cloud className="size-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {connected
                        ? connection?.accountLabel || t("Connesso", "Connected", "Connecté", "Conectado", "Verbunden")
                        : oauthApp?.source === "user"
                          ? t(`OAuth app personale (…${oauthApp.clientIdLast4})`, `Your OAuth app (…${oauthApp.clientIdLast4})`)
                          : oauthApp?.source === "server"
                            ? t("OAuth app del server", "Server OAuth app", "Application OAuth du serveur", "Aplicación OAuth del servidor", "Server-OAuth-App")
                            : t("Aggiungi le tue credenziali OAuth per collegarti", "Add your OAuth credentials to connect", "Ajoutez vos identifiants OAuth pour connecter", "Añade tus credenciales OAuth para conectar", "Eigene OAuth-Daten hinzufügen, um zu verbinden")}
                    </div>
                  </div>
                  {connected ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onDisconnect(p.id)}
                      disabled={busyProvider === p.id}
                    >
                      <Trash2 className="size-3.5 mr-1.5" />
                      {t("Disconnetti", "Disconnect", "Déconnecter", "Desconectar", "Trennen")}
                    </Button>
                  ) : available ? (
                    <Button
                      size="sm"
                      onClick={() => void onConnect(p.id)}
                      disabled={busyProvider === p.id}
                    >
                      <Plug className="size-3.5 mr-1.5" />
                      {t("Connetti", "Connect", "Connecter", "Conectar", "Verbinden")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const target = document.querySelector(`[data-oauth-config="${p.id}"]`) as HTMLElement | null;
                        if (!target) return;
                        const addBtn = Array.from(target.querySelectorAll("button"))
                          .find((b) => /OAuth app/i.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
                        addBtn?.click();
                        target.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      <Plug className="size-3.5 mr-1.5" />
                      {t("Aggiungi credenziali", "Add credentials", "Ajouter les identifiants", "Añadir credenciales", "Anmeldedaten hinzufügen")}
                    </Button>
                  )}
                </div>
                {!connected ? (
                  <div data-oauth-config={p.id}>
                    <OAuthAppConfig provider={p.id} t={t} onChanged={refresh} hasUserCreds={oauthApp?.source === "user"} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <WatcherSection
        t={t}
        watchers={watchers}
        connections={connectedSet}
        onChange={refresh}
      />
    </div>
  );
}

function WatcherSection({
  t,
  watchers,
  connections,
  onChange,
}: {
  t: Translator;
  watchers: Watcher[];
  connections: Set<string>;
  onChange: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = React.useState(false);

  const onToggle = async (w: Watcher) => {
    try {
      const res = await fetch(`/api/integrations/watchers/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !w.active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChange();
    } catch (err) {
      toast({
        title: t("Errore", "Error", "Erreur", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const onDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/integrations/watchers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChange();
    } catch (err) {
      toast({
        title: t("Errore", "Error", "Erreur", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          {t("Cartelle osservate", "Watched folders", "Dossiers surveillés", "Carpetas vigiladas", "Beobachtete Ordner")}
        </h4>
        <Button size="sm" variant="ghost" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="size-3.5 mr-1.5" />
          {t("Aggiungi", "Add", "Ajouter", "Añadir", "Hinzufügen")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Estracto rileva nuovi file in queste cartelle e li invia all'OCR.",
          "Extracto detects new files in these folders and pushes them through OCR.",
          "Extracto détecte les nouveaux fichiers dans ces dossiers et les passe à l'OCR.",
          "Extracto detecta archivos nuevos en estas carpetas y los procesa con OCR.",
          "Extracto erkennt neue Dateien in diesen Ordnern und schickt sie durch OCR.",
        )}
      </p>

      {showCreate ? (
        <CreateWatcherForm
          t={t}
          connections={connections}
          onCancel={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await onChange();
          }}
        />
      ) : null}

      {watchers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {t("Nessuna cartella osservata", "No watched folders yet", "Aucun dossier surveillé", "No hay carpetas vigiladas", "Noch keine beobachteten Ordner")}
        </p>
      ) : (
        <div className="grid gap-2">
          {watchers.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <RefreshCw className={`size-4 ${w.active ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{w.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {w.provider} · {w.folderPath || "/"} · {w.intervalSeconds}s · {w.model}
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 truncate">
                    {w.lastPolledAt
                      ? `${t("ultimo controllo", "last checked", "dernier passage", "último chequeo", "zuletzt geprüft")}: ${new Date(w.lastPolledAt).toLocaleString()}`
                      : t("non ancora controllato", "not checked yet", "jamais vérifié", "aún sin chequear", "noch nicht geprüft")}
                    {typeof w.ingestedCount === "number"
                      ? ` · ${w.ingestedCount} ${t("file", "items", "fichiers", "elementos", "Dateien")}`
                      : ""}
                  </div>
                  {w.lastError ? (
                    <div className="text-xs text-destructive truncate">{w.lastError}</div>
                  ) : null}
                </div>
                <Button size="icon" variant="ghost" onClick={() => void onToggle(w)} aria-label={w.active ? "Pause" : "Resume"}>
                  {w.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void onDelete(w.id)} aria-label="Delete">
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateWatcherForm({
  t,
  connections,
  onCancel,
  onCreated,
}: {
  t: Translator;
  connections: Set<string>;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const { toast } = useToast();
  const firstConnected = PROVIDERS.find((p) => connections.has(p.id))?.id ?? "local";
  const [provider, setProvider] = React.useState<WatcherProvider>(firstConnected);
  const [name, setName] = React.useState("");
  const [folderPath, setFolderPath] = React.useState("");
  const [model, setModel] = React.useState("");
  const [intervalSeconds, setIntervalSeconds] = React.useState(300);
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast({ title: t("Inserisci un nome", "Name is required", "Nom requis", "Nombre requerido", "Name erforderlich"), variant: "destructive" });
      return;
    }
    if (!model.trim()) {
      toast({ title: t("Inserisci un modello", "Model is required", "Modèle requis", "Modelo requerido", "Modell erforderlich"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/watchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, name, folderPath, model, intervalSeconds, active }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      await onCreated();
    } catch (err) {
      toast({
        title: t("Creazione fallita", "Create failed", "Échec de la création", "Error al crear", "Erstellen fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-3">
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t("Provider", "Provider", "Fournisseur", "Proveedor", "Anbieter")}</Label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as WatcherProvider)}
                className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm"
              >
                {WATCHER_OPTIONS.map((p) => {
                  const disabled = p.id !== "local" && !connections.has(p.id);
                  return (
                    <option key={p.id} value={p.id} disabled={disabled}>
                      {p.label}
                      {disabled ? ` (${t("non connesso", "not connected", "non connecté", "no conectado", "nicht verbunden")})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <Label className="text-xs">{t("Nome", "Name", "Nom", "Nombre", "Name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="invoices-inbox" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">
                {provider === "dropbox"
                  ? t("Percorso (es. /Inbox)", "Path (e.g. /Inbox)", "Chemin (ex. /Inbox)", "Ruta (p.ej. /Inbox)", "Pfad (z. B. /Inbox)")
                  : provider === "local"
                    ? t("Sotto-cartella in LOCAL_WATCH_ROOT", "Sub-folder under LOCAL_WATCH_ROOT", "Sous-dossier sous LOCAL_WATCH_ROOT", "Subcarpeta bajo LOCAL_WATCH_ROOT", "Unterordner unter LOCAL_WATCH_ROOT")
                    : t("ID cartella", "Folder ID", "ID dossier", "ID de carpeta", "Ordner-ID")}
              </Label>
              <div className="flex gap-1.5">
                <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder={provider === "dropbox" ? "/Inbox" : provider === "local" ? "inbox" : "root"} />
                {provider === "google_drive" || provider === "onedrive" || provider === "dropbox" ? (
                  <Button type="button" size="icon" variant="ghost" onClick={() => setPickerOpen(true)} aria-label={t("Sfoglia cartelle", "Browse folders", "Parcourir", "Explorar", "Durchsuchen")} className="shrink-0">
                    <Folder className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {provider === "onedrive" ? (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t(
                    "Solo cartelle dentro l'app folder OneDrive sono accessibili (scope Files.ReadWrite.AppFolder). Folder ID arbitrari restituiscono 403.",
                    "Only folders inside the OneDrive app folder are accessible (Files.ReadWrite.AppFolder scope). Arbitrary folder IDs return 403.",
                    "Seuls les dossiers dans l'app folder OneDrive sont accessibles (scope Files.ReadWrite.AppFolder). Les ID arbitraires renvoient 403.",
                    "Solo las carpetas dentro de la carpeta de la app de OneDrive son accesibles (scope Files.ReadWrite.AppFolder). Los ID arbitrarios devuelven 403.",
                    "Nur Ordner im OneDrive-App-Ordner sind erreichbar (Scope Files.ReadWrite.AppFolder). Beliebige Ordner-IDs liefern 403.",
                  )}
                </p>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">{t("Modello", "Model", "Modèle", "Modelo", "Modell")}</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="mistral-ocr-latest" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <Label className="text-xs">{t("Intervallo (secondi)", "Interval (seconds)", "Intervalle (sec)", "Intervalo (seg)", "Intervall (Sek.)")}</Label>
              <Input
                type="number"
                min={60}
                max={86400}
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Math.max(60, Math.min(86400, Number(e.target.value) || 60)))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="watcher-active" className="text-xs">
                {t("Attivo", "Active", "Actif", "Activo", "Aktiv")}
              </Label>
              <Switch id="watcher-active" checked={active} onCheckedChange={setActive} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {t("Crea", "Create", "Créer", "Crear", "Erstellen")}
            </Button>
          </div>
        </form>
      </CardContent>
      {provider === "google_drive" || provider === "onedrive" || provider === "dropbox" ? (
        <FolderPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          provider={provider as CloudProvider}
          initialPath={folderPath || undefined}
          onSelect={(picked) => setFolderPath(picked)}
          t={t}
        />
      ) : null}
    </Card>
  );
}

function OAuthAppConfig({
  provider,
  t,
  onChanged,
  hasUserCreds,
}: {
  provider: CloudProvider;
  t: Translator;
  onChanged: () => Promise<void>;
  hasUserCreds: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const fetchInfo = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/${provider}/oauth-app`);
      if (!res.ok) return;
      const json = (await res.json()) as { redirectUri?: string };
      if (json.redirectUri) setRedirectUri(json.redirectUri);
    } catch { /* ignore */ }
  }, [provider]);

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInfo();
  }, [open, fetchInfo]);

  const onSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: t("Compila entrambi i campi", "Fill in both fields", "Remplis les deux champs", "Rellena ambos campos", "Fülle beide Felder aus"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/integrations/${provider}/oauth-app`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
      }
      setClientId("");
      setClientSecret("");
      setOpen(false);
      await onChanged();
      toast({ title: t("Credenziali OAuth salvate", "OAuth credentials saved", "Identifiants OAuth enregistrés", "Credenciales OAuth guardadas", "OAuth-Daten gespeichert") });
    } catch (err) {
      toast({
        title: t("Errore", "Error", "Erreur", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await fetch(`/api/integrations/${provider}/oauth-app`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center justify-end gap-2">
        {hasUserCreds ? (
          <Button size="sm" variant="ghost" onClick={() => void onClear()} disabled={busy}>
            {t("Rimuovi credenziali OAuth", "Remove OAuth credentials", "Retirer les identifiants OAuth", "Quitar credenciales OAuth", "OAuth-Daten entfernen")}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {hasUserCreds
            ? t("Modifica OAuth app", "Edit OAuth app", "Modifier OAuth app", "Editar OAuth app", "OAuth-App bearbeiten")
            : t("Aggiungi OAuth app", "Add OAuth app", "Ajouter OAuth app", "Añadir OAuth app", "OAuth-App hinzufügen")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-secondary/30 p-3">
      <div>
        <Label className="text-xs">
          {t("URI di reindirizzamento (incollalo nella console del provider)", "Redirect URI (paste this in the provider console)", "URI de redirection (à coller dans la console du fournisseur)", "URI de redirección (pégalo en la consola del proveedor)", "Weiterleitungs-URI (im Provider-Dashboard einfügen)")}
        </Label>
        <Input readOnly value={redirectUri} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <div>
        <Label className="text-xs">Client ID</Label>
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
      </div>
      <div>
        <Label className="text-xs">Client secret</Label>
        <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
        </Button>
        <Button size="sm" onClick={() => void onSave()} disabled={busy}>
          {t("Salva", "Save", "Enregistrer", "Guardar", "Speichern")}
        </Button>
      </div>
    </div>
  );
}
