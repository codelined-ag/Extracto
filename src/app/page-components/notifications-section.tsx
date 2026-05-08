"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface NotificationsSectionProps {
  t: Translator;
}

export function NotificationsSection({ t }: NotificationsSectionProps) {
  const { toast } = useToast();
  const [permission, setPermission] = React.useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    void navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    });
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const keyResp = await fetch("/api/push/subscribe", { cache: "no-store" });
      if (!keyResp.ok) throw new Error(t(
        "Impossibile recuperare la chiave VAPID pubblica.",
        "Could not fetch the VAPID public key.",
        "Impossible de récupérer la clé VAPID publique.",
        "No se pudo obtener la clave VAPID pública.",
        "VAPID-Public-Key konnte nicht geladen werden.",
      ));
      const { publicKey } = (await keyResp.json()) as { publicKey: string };

      const reg = await navigator.serviceWorker.ready;
      const keyBytes = urlBase64ToUint8Array(publicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
      });
      const subJson = sub.toJSON();
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!r.ok) throw new Error(t(
        `Il server ha rifiutato la sottoscrizione (${r.status}).`,
        `Server rejected the subscription (${r.status}).`,
        `Le serveur a refusé l'abonnement (${r.status}).`,
        `El servidor rechazó la suscripción (${r.status}).`,
        `Server hat das Abonnement abgelehnt (${r.status}).`,
      ));
      setSubscribed(true);
      toast({ title: t("Notifiche attivate", "Notifications enabled", "Notifications activées", "Notificaciones activadas", "Benachrichtigungen aktiviert") });
    } catch (err) {
      toast({
        title: t("Attivazione non riuscita", "Enable failed", "Échec de l'activation", "Error al activar", "Aktivieren fehlgeschlagen"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      toast({
        title: t("Disattivazione non riuscita", "Disable failed", "Échec", "Error", "Fehler"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (permission === "unsupported") {
    return (
      <div className="text-sm text-muted-foreground">
        {t(
          "Il tuo browser non supporta le notifiche push.",
          "Your browser does not support push notifications.",
          "Votre navigateur ne prend pas en charge les notifications push.",
          "Tu navegador no admite notificaciones push.",
          "Dein Browser unterstützt keine Push-Benachrichtigungen.",
        )}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {t("Notifiche push", "Push notifications", "Notifications push", "Notificaciones push", "Push-Benachrichtigungen")}
        </h3>
        <p className="text-xs text-muted-foreground/80">
          {t(
            "Ricevi una notifica quando un job lungo termina, anche con la scheda chiusa.",
            "Get notified when a long job finishes, even with the tab closed.",
            "Soyez notifié à la fin d'un job long, même quand l'onglet est fermé.",
            "Recibe una notificación al terminar un job largo, incluso con la pestaña cerrada.",
            "Erhalte eine Benachrichtigung, wenn ein langer Job endet, auch bei geschlossenem Tab.",
          )}
        </p>
      </header>

      <div className="flex items-center gap-2">
        {subscribed ? (
          <Button variant="outline" onClick={disable} disabled={busy}>
            {t("Disattiva notifiche", "Disable notifications", "Désactiver", "Desactivar", "Deaktivieren")}
          </Button>
        ) : (
          <Button onClick={enable} disabled={busy}>
            {t("Attiva notifiche", "Enable notifications", "Activer les notifications", "Activar notificaciones", "Benachrichtigungen aktivieren")}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {permission === "granted"
            ? t("Permesso concesso", "Permission granted", "Permission accordée", "Permiso concedido", "Erlaubnis erteilt")
            : permission === "denied"
              ? t("Permesso negato (modifica nelle impostazioni del browser)", "Permission denied (change in browser settings)", "Permission refusée (à modifier dans le navigateur)", "Permiso denegado (cambia en el navegador)", "Erlaubnis abgelehnt (im Browser ändern)")
              : t("In attesa del tuo permesso", "Waiting for permission", "En attente de l'autorisation", "Esperando permiso", "Wartet auf Erlaubnis")}
        </span>
      </div>
    </section>
  );
}
