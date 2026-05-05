"use client";

import * as React from "react";
import { History, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

const EVENTS = ["job.created", "job.completed", "job.failed", "watcher.ingested"] as const;
type EventName = (typeof EVENTS)[number];

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastFiredAt: string | null;
  failureCount: number;
  createdAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: number | null;
  ok: boolean;
  durationMs: number | null;
  errorMessage: string | null;
  attemptedAt: string;
}

export function WebhooksSection({ t }: { t: Translator }) {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = React.useState<WebhookRow[]>([]);
  const [showCreate, setShowCreate] = React.useState(false);
  const [openDeliveries, setOpenDeliveries] = React.useState<string | null>(null);
  const [deliveries, setDeliveries] = React.useState<Record<string, Delivery[]>>({});

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/v1/webhooks");
      if (!res.ok) return;
      const json = (await res.json()) as { webhooks: WebhookRow[] };
      setWebhooks(json.webhooks ?? []);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      toast({ title: t("Eliminazione fallita", "Delete failed", "Échec", "Error", "Fehler"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const toggleActive = async (w: WebhookRow) => {
    try {
      const res = await fetch(`/api/v1/webhooks/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !w.active }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      toast({ title: t("Errore", "Error", "Erreur", "Error", "Fehler"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const fetchDeliveries = async (id: string) => {
    if (openDeliveries === id) {
      setOpenDeliveries(null);
      return;
    }
    setDeliveries((prev) => ({ ...prev, [id]: [] }));
    try {
      const res = await fetch(`/api/v1/webhooks/${id}/deliveries?limit=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { deliveries: Delivery[] };
      setDeliveries((prev) => ({ ...prev, [id]: json.deliveries ?? [] }));
      setOpenDeliveries(id);
    } catch (err) {
      toast({ title: t("Errore", "Error", "Erreur", "Error", "Fehler"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Webhook className="size-4 text-primary" />
          {t("Webhook", "Webhooks", "Webhooks", "Webhooks", "Webhooks")}
        </h4>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => void refresh()} className="h-7 w-7">
            <RefreshCw className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="size-3.5 mr-1.5" />
            {t("Aggiungi", "Add", "Ajouter", "Añadir", "Hinzufügen")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Endpoint HTTP che riceve POST firmati HMAC quando i job cambiano stato.",
          "HTTP endpoints that receive HMAC-signed POSTs when jobs change state.",
          "Endpoints HTTP qui reçoivent des POST signés HMAC quand les jobs changent d'état.",
          "Endpoints HTTP que reciben POST firmados HMAC cuando los trabajos cambian de estado.",
          "HTTP-Endpunkte, die HMAC-signierte POSTs erhalten, wenn Jobs ihren Status ändern.",
        )}
      </p>

      {showCreate ? (
        <CreateForm t={t} onCancel={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); await refresh(); }} />
      ) : null}

      {webhooks.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {t("Nessun webhook configurato.", "No webhooks yet.", "Aucun webhook.", "Sin webhooks aún.", "Noch keine Webhooks.")}
        </p>
      ) : (
        <div className="space-y-2">
          {webhooks.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate" title={w.url}>{w.url}</div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {w.events.map((ev) => (
                        <Badge key={ev} variant="outline" className="text-[10px] py-0 px-1">{ev}</Badge>
                      ))}
                      {w.failureCount > 0 ? (
                        <Badge variant="destructive" className="text-[10px] py-0 px-1">{w.failureCount} {t("errori", "failures", "échecs", "errores", "Fehler")}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <Switch checked={w.active} onCheckedChange={() => void toggleActive(w)} />
                  <Button size="icon" variant="ghost" onClick={() => void fetchDeliveries(w.id)} className="h-7 w-7" aria-label={t("Cronologia consegne", "Delivery history", "Historique de livraison", "Historial de entregas", "Auslieferungsverlauf")}>
                    <History className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => void onDelete(w.id)} className="h-7 w-7" aria-label="Delete">
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
                {openDeliveries === w.id && deliveries[w.id] ? (
                  <div className="rounded border bg-secondary/20 p-2 max-h-48 overflow-y-auto space-y-1">
                    {deliveries[w.id].length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">{t("Nessuna consegna ancora.", "No deliveries yet.", "Aucune livraison.", "Sin entregas.", "Noch keine Auslieferungen.")}</p>
                    ) : deliveries[w.id].map((d) => (
                      <div key={d.id} className="flex items-center gap-2 text-[11px] font-mono">
                        <Badge variant={d.ok ? "secondary" : "destructive"} className="text-[10px] py-0 px-1">{d.status ?? "n/a"}</Badge>
                        <span className="truncate flex-1">{d.event}</span>
                        {d.durationMs ? <span className="text-muted-foreground">{d.durationMs}ms</span> : null}
                        <span className="text-muted-foreground">{new Date(d.attemptedAt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateForm({ t, onCancel, onCreated }: { t: Translator; onCancel: () => void; onCreated: () => Promise<void> }) {
  const { toast } = useToast();
  const [url, setUrl] = React.useState("");
  const [events, setEvents] = React.useState<EventName[]>(["job.completed"]);
  const [busy, setBusy] = React.useState(false);
  const [createdSecret, setCreatedSecret] = React.useState<string | null>(null);

  const toggleEvent = (e: EventName) => {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  const submit = async () => {
    if (!url.trim() || events.length === 0) {
      toast({ title: t("URL ed eventi richiesti", "URL and at least one event required", "URL et événements requis", "URL y eventos requeridos", "URL und Ereignisse erforderlich"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), events }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; secret?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.secret) setCreatedSecret(json.secret);
      else {
        await onCreated();
      }
    } catch (err) {
      toast({ title: t("Creazione fallita", "Create failed", "Échec", "Error", "Fehler"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (createdSecret) {
    return (
      <Card>
        <CardContent className="p-3 space-y-2">
          <Label className="text-xs">
            {t("Secret HMAC (mostrato una sola volta)", "HMAC secret (shown once only)", "Secret HMAC (montré une seule fois)", "Secret HMAC (mostrado una sola vez)", "HMAC-Secret (nur einmal angezeigt)")}
          </Label>
          <code className="block text-[11px] font-mono p-2 bg-secondary rounded break-all">{createdSecret}</code>
          <p className="text-[11px] text-muted-foreground">
            {t(
              "Salvalo subito: usalo per verificare la firma X-Extracto-Signature dei POST in arrivo.",
              "Copy it now: use it to verify the X-Extracto-Signature header on incoming POSTs.",
              "Copie-le tout de suite : utilise-le pour vérifier l'en-tête X-Extracto-Signature.",
              "Cópialo ya: úsalo para verificar la cabecera X-Extracto-Signature.",
              "Jetzt kopieren: damit verifizierst du den X-Extracto-Signature-Header eingehender POSTs.",
            )}
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void onCreated()}>
              {t("Ho copiato il secret", "I copied the secret", "Secret copié", "Secret copiado", "Secret kopiert")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div>
          <Label className="text-xs">URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/extracto" />
        </div>
        <div>
          <Label className="text-xs">{t("Eventi", "Events", "Événements", "Eventos", "Ereignisse")}</Label>
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {EVENTS.map((ev) => (
              <button
                key={ev}
                type="button"
                onClick={() => toggleEvent(ev)}
                className={`text-[11px] font-mono px-2 py-1 rounded border ${events.includes(ev) ? "bg-primary/10 border-primary/40" : "border-border"}`}
              >
                {ev}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>
            {t("Crea", "Create", "Créer", "Crear", "Erstellen")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
