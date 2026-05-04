"use client";

import * as React from "react";
import { LoaderCircleIcon } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ClientApiSettings, ProviderKind } from "@/lib/api-types";
import { normalizeProvider } from "@/lib/api-types";
import type { Translator } from "@/app/page-components/types";

const STORAGE_KEY = "extracto:setup-completed-v1";

export function isSetupCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

export function markSetupCompleted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } catch {
  }
}

export function clearSetupFlag() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
  }
}

export type SetupWizardSave = (next: { provider: ProviderKind; apiEndpoint: string; apiKey: string }) => Promise<void>;

export interface SetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Translator;
  initial: ClientApiSettings;
  defaultEndpointForProvider: (p: ProviderKind) => string;
  onSave: SetupWizardSave;
  onFinished: () => void;
  onSkip?: () => void;
}

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  ollama: "Ollama",
  mistral: "Mistral OCR API",
  openrouter: "OpenRouter",
  openai_compat: "OpenAI-compatible",
};

export function SetupWizard({
  open,
  onOpenChange,
  t,
  initial,
  defaultEndpointForProvider,
  onSave,
  onFinished,
  onSkip,
}: SetupWizardProps) {
  const [step, setStep] = React.useState(0);
  const [provider, setProvider] = React.useState<ProviderKind>(initial.provider);
  const [apiEndpoint, setApiEndpoint] = React.useState<string>(initial.apiEndpoint || defaultEndpointForProvider(initial.provider));
  const [apiKey, setApiKey] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const needsKey = provider !== "ollama";

  const goNext = async () => {
    setError(null);
    if (step === 0) {
      setStep(1);
      return;
    }
    if (step === 1) {
      const reusingSavedKey = needsKey && initial.hasApiKey && provider === initial.provider;
      if (needsKey && !apiKey.trim() && !reusingSavedKey) {
        setError(t(
          "Inserisci una chiave API per questo provider.",
          "Paste an API key for this provider.",
          "Saisissez une clé API pour ce fournisseur.",
          "Pega una clave API para este proveedor.",
          "API-Schlüssel für diesen Provider eingeben.",
        ));
        return;
      }
      setSaving(true);
      try {
        await onSave({ provider, apiEndpoint: apiEndpoint.trim(), apiKey: apiKey.trim() });
        setStep(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("Salvataggio fallito.","Save failed.","Échec de l'enregistrement.","No se pudo guardar.","Speichern fehlgeschlagen."));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (step === 2) {
      finish();
    }
  };

  const finish = () => {
    markSetupCompleted();
    onOpenChange(false);
    onFinished();
  };

  const skip = () => {
    markSetupCompleted();
    onOpenChange(false);
    onSkip?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 0 && t("Benvenuto in Extracto", "Welcome to Extracto", "Bienvenue sur Extracto", "Bienvenido a Extracto", "Willkommen bei Extracto")}
            {step === 1 && t("Connetti il tuo provider", "Connect your provider", "Connectez votre fournisseur", "Conecta tu proveedor", "Provider verbinden")}
            {step === 2 && t("Tutto pronto", "You are ready", "Tout est prêt", "Todo listo", "Du bist startklar")}
          </DialogTitle>
          <DialogDescription>
            {step === 0 && t(
              "In due passaggi colleghiamo il modello che leggerà i tuoi documenti. Puoi sempre cambiare in Impostazioni.",
              "Two quick steps to connect the model that reads your documents. You can change this any time in Settings.",
              "Deux étapes rapides pour connecter le modèle qui lira vos documents. Modifiable dans Paramètres.",
              "Dos pasos rápidos para conectar el modelo que leerá tus documentos. Lo puedes cambiar luego en Configuración.",
              "Zwei kurze Schritte, um das Modell zu verbinden, das deine Dokumente liest. Jederzeit in den Einstellungen änderbar.",
            )}
            {step === 1 && t(
              "Scegli dove gira il modello e incolla la chiave se serve.",
              "Pick where the model runs and paste the key if needed.",
              "Choisissez où le modèle s'exécute et collez la clé si nécessaire.",
              "Elige dónde se ejecuta el modelo y pega la clave si hace falta.",
              "Wähle, wo das Modell läuft, und füge bei Bedarf den Schlüssel ein.",
            )}
            {step === 2 && t(
              "Configurazione salvata. Carica un documento per iniziare.",
              "Settings saved. Upload a document to get started.",
              "Réglages enregistrés. Chargez un document pour commencer.",
              "Configuración guardada. Sube un documento para empezar.",
              "Einstellungen gespeichert. Lade ein Dokument hoch, um loszulegen.",
            )}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-3 py-2">
            <ul className="text-sm text-muted-foreground/90 space-y-2 list-disc pl-5">
              <li>{t("OCR locale o cloud, scegli tu.","Local or cloud OCR, your call.","OCR local ou cloud, à vous de voir.","OCR local o en la nube, tú eliges.","OCR lokal oder Cloud, du entscheidest.")}</li>
              <li>{t("Markdown pulito, JSON strutturato, esportazioni S3.","Clean markdown, structured JSON, S3 exports.","Markdown propre, JSON structuré, exports S3.","Markdown limpio, JSON estructurado, exportes S3.","Sauberes Markdown, strukturiertes JSON, S3-Exporte.")}</li>
              <li>{t("Cinque lingue, multi-utente, API stabile.","Five languages, multi-user, stable API.","Cinq langues, multi-utilisateur, API stable.","Cinco idiomas, multiusuario, API estable.","Fünf Sprachen, Mehrbenutzer, stabile API.")}</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
                {t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}
              </Label>
              <Select
                value={provider}
                onValueChange={(value) => {
                  const next = normalizeProvider(value);
                  setProvider(next);
                  setApiEndpoint(defaultEndpointForProvider(next));
                  setApiKey("");
                }}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">{PROVIDER_LABELS.ollama}</SelectItem>
                  <SelectItem value="mistral">{PROVIDER_LABELS.mistral}</SelectItem>
                  <SelectItem value="openrouter">{PROVIDER_LABELS.openrouter}</SelectItem>
                  <SelectItem value="openai_compat">{PROVIDER_LABELS.openai_compat}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Endpoint</Label>
              <Input value={apiEndpoint} onChange={(e) => setApiEndpoint(e.target.value)} placeholder={defaultEndpointForProvider(provider)} />
            </div>
            {needsKey ? (
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">API key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={initial.hasApiKey ? t("Salvata (nascosta)","Saved (hidden)","Enregistrée (masquée)","Guardada (oculta)","Gespeichert (verborgen)") : "sk-..."}
                />
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground/80">
                {t(
                  "Ollama gira sul tuo computer e non richiede una chiave.",
                  "Ollama runs on your machine and needs no key.",
                  "Ollama tourne sur votre machine et ne nécessite aucune clé.",
                  "Ollama corre en tu equipo y no necesita clave.",
                  "Ollama läuft lokal und braucht keinen Schlüssel.",
                )}
              </p>
            )}
            {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-foreground/85">
              {t(
                "Ora ti facciamo fare un giro veloce dell'interfaccia.",
                "Next we will give you a quick tour of the UI.",
                "Maintenant, nous allons vous faire visiter rapidement l'interface.",
                "Ahora te haremos un recorrido rápido por la interfaz.",
                "Jetzt zeigen wir dir kurz, wo alles ist.",
              )}
            </p>
          </div>
        )}

        <DialogFooter className="flex flex-row sm:justify-between gap-2">
          {step !== 2 ? (
            <Button variant="ghost" onClick={skip} disabled={saving}>
              {t("Salta","Skip","Passer","Saltar","Überspringen")}
            </Button>
          ) : <span />}
          <Button onClick={goNext} disabled={saving}>
            {saving ? <LoaderCircleIcon size={16} className="inline-flex items-center justify-center mr-1.5 animate-spin" /> : null}
            {step === 0 && t("Iniziamo","Let's go","C'est parti","Vamos","Los geht's")}
            {step === 1 && t("Salva e continua","Save and continue","Enregistrer et continuer","Guardar y continuar","Speichern und weiter")}
            {step === 2 && t("Mostrami il tour","Show me the tour","Faire la visite","Hacer el tour","Tour starten")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
