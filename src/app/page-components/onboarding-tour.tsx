"use client";

import * as React from "react";

import "@sjmc11/tourguidejs/dist/css/tour.min.css";

import type { Translator } from "@/app/page-components/types";
import { isSetupCompleted } from "@/app/page-components/setup-wizard";

const STORAGE_KEY = "extracto:onboarding-completed-v1";

type TourClient = {
  start: () => void;
  finishTour: () => void;
  isVisible: () => boolean;
  exit: () => void;
  onFinish: (cb: () => void) => void;
  onAfterExit: (cb: () => void) => void;
};

let cachedClientPromise: Promise<unknown> | null = null;
async function loadTourClient(): Promise<unknown> {
  if (cachedClientPromise) return cachedClientPromise;
  cachedClientPromise = import("@sjmc11/tourguidejs/dist/tour").then((m) => {
    return (m as { TourGuideClient: unknown }).TourGuideClient;
  });
  return cachedClientPromise;
}

interface TourStep {
  selector: string;
  title: string;
  content: string;
}

function buildSteps(t: Translator): TourStep[] {
  return [
    {
      selector: "[data-tour='upload-zone']",
      title: t("Carica documenti", "Upload documents", "Charger des documents", "Subir documentos", "Dokumente hochladen"),
      content: t(
        "Trascina o clicca per caricare PDF e immagini. Puoi caricarne più di uno alla volta.",
        "Drop or click to upload PDFs and images. You can upload several at once.",
        "Glissez ou cliquez pour charger des PDF et images. Plusieurs fichiers à la fois.",
        "Arrastra o haz clic para subir PDFs e imágenes. Varios a la vez.",
        "PDFs und Bilder hierher ziehen oder klicken. Mehrere gleichzeitig möglich.",
      ),
    },
    {
      selector: "[data-tour='file-queue']",
      title: t("La tua coda", "Your queue", "Votre file d'attente", "Tu cola", "Deine Warteschlange"),
      content: t(
        "I file caricati restano in coda finché non avvii l'OCR. Si conservano anche dopo un refresh.",
        "Uploaded files sit here until you run OCR. They survive a page refresh.",
        "Les fichiers chargés restent ici jusqu'au lancement de l'OCR. Ils survivent à un rechargement.",
        "Los archivos subidos esperan aquí hasta que inicies el OCR. Sobreviven al refresco.",
        "Hochgeladene Dateien warten hier, bis du OCR startest. Sie überleben einen Reload.",
      ),
    },
    {
      selector: "[data-tour='page-picker']",
      title: t("Scegli le pagine", "Pick the pages", "Choisir les pages", "Elegir las páginas", "Seiten auswählen"),
      content: t(
        "Clicca i thumbnail per attivare o disattivare le pagine. Solo quelle selezionate verranno processate.",
        "Click thumbnails to toggle pages on or off. Only selected pages get OCR'd.",
        "Cliquez sur les miniatures pour activer ou désactiver les pages. Seules les sélectionnées sont traitées.",
        "Haz clic en las miniaturas para activar/desactivar páginas. Solo las elegidas pasan por OCR.",
        "Klicke Thumbnails an, um Seiten ein- oder auszuschalten. Nur ausgewählte werden OCR'd.",
      ),
    },
    {
      selector: "[data-tour='header-settings']",
      title: t("Impostazioni", "Settings", "Paramètres", "Configuración", "Einstellungen"),
      content: t(
        "Configura provider, modello, knowledge base, archiviazione e template.",
        "Configure provider, model, knowledge base, storage, and templates.",
        "Configurez fournisseur, modèle, base de connaissances, stockage et modèles.",
        "Configura proveedor, modelo, base de conocimiento, almacenamiento y plantillas.",
        "Konfiguriere Provider, Modell, Wissensdatenbank, Speicher und Vorlagen.",
      ),
    },
    {
      selector: "[data-tour='header-account']",
      title: t("Il tuo account", "Your account", "Votre compte", "Tu cuenta", "Dein Konto"),
      content: t(
        "Cambia lingua, gestisci chiavi API, attiva le notifiche push e controlla il tuo utilizzo.",
        "Change language, manage API keys, enable push notifications, and check your usage.",
        "Changez la langue, gérez les clés API, activez les notifications push et consultez votre utilisation.",
        "Cambia idioma, gestiona claves API, activa notificaciones push y consulta tu uso.",
        "Sprache ändern, API-Schlüssel verwalten, Push-Benachrichtigungen aktivieren und Nutzung prüfen.",
      ),
    },
    {
      selector: "[data-tour='history-btn']",
      title: t("Cronologia", "History", "Historique", "Historial", "Verlauf"),
      content: t(
        "Sfoglia, cerca e riapri i job OCR passati. Puoi rieseguirli con un click.",
        "Browse, search, and reopen past OCR jobs. Re-run any of them with one click.",
        "Parcourez, cherchez et rouvrez les jobs OCR passés. Relancez en un clic.",
        "Explora, busca y reabre trabajos OCR pasados. Reejecuta con un clic.",
        "Vergangene OCR-Jobs durchsuchen und erneut öffnen. Mit einem Klick erneut ausführen.",
      ),
    },
  ];
}

async function runTour(t: Translator, onClose?: () => void) {
  if (typeof window === "undefined") return;
  const ClientCtor = (await loadTourClient()) as new (opts: unknown) => TourClient;
  const steps = buildSteps(t).filter((s) => document.querySelector(s.selector));
  if (steps.length === 0) return;
  const client = new ClientCtor({
    steps: steps.map((s) => ({ title: s.title, content: s.content, target: s.selector })),
    showStepDots: true,
    closeButton: true,
    backdropClick: false,
    nextLabel: t("Avanti", "Next", "Suivant", "Siguiente", "Weiter"),
    prevLabel: t("Indietro", "Back", "Précédent", "Atrás", "Zurück"),
    finishLabel: t("Fatto", "Done", "Terminé", "Listo", "Fertig"),
    dialogClass: "extracto-tourguide",
  });
  if (onClose) {
    try {
      client.onFinish(onClose);
      client.onAfterExit(onClose);
    } catch {
      }
  }
  client.start();
}

export function markOnboardingCompleted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
  }
}

export function isOnboardingCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

export function clearOnboardingFlag() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
  }
}

export function useOnboardingTour(t: Translator) {
  const start = React.useCallback(async () => {
    await runTour(t, markOnboardingCompleted);
  }, [t]);
  return { start };
}

export interface OnboardingTourProps {
  t: Translator;
}

export function OnboardingTour({ t }: OnboardingTourProps) {
  React.useEffect(() => {
    if (!isSetupCompleted()) return;
    if (isOnboardingCompleted()) return;
    const timeout = window.setTimeout(() => {
      void runTour(t, markOnboardingCompleted);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [t]);
  return null;
}
