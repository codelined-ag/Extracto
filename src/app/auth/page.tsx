"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Languages, Loader2, Mail, Lock, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

interface AuthFormState {
  email: string;
  password: string;
  name: string;
}

interface SessionResponse {
  authenticated?: boolean;
}

type UiLanguage = "it" | "en" | "fr" | "es" | "de";
const UI_LANGUAGE_STORAGE_KEY = "extracto:ui-language:v1";

const UI_LANGUAGES: UiLanguage[] = ["it", "en", "fr", "es", "de"];
const UI_LANGUAGE_LABELS: Record<UiLanguage, string> = {
  it: "IT",
  en: "EN",
  fr: "FR",
  es: "ES",
  de: "DE",
};

function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (UI_LANGUAGES as string[]).includes(value);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function AuthPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [loading, setLoading] = React.useState(false);
  const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("it");
  const [form, setForm] = React.useState<AuthFormState>({
    email: "",
    password: "",
    name: "",
  });
  const [authChecked, setAuthChecked] = React.useState(false);
  const t = React.useCallback(
    (it: string, en: string, fr?: string, es?: string, de?: string) => {
      switch (uiLanguage) {
        case "it":
          return it;
        case "fr":
          return fr ?? en;
        case "es":
          return es ?? en;
        case "de":
          return de ?? en;
        default:
          return en;
      }
    },
    [uiLanguage]
  );

  React.useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
      if (isUiLanguage(storedLanguage)) {
        setUiLanguage(storedLanguage);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
    } catch {
      // ignore storage errors
    }
  }, [uiLanguage]);

  React.useEffect(() => {
    let active = true;
    const verifySession = async () => {
      try {
        const response = await fetch("/api/auth/session");
        const payload = (await response.json().catch(() => null)) as SessionResponse | null;
        if (!active) return;
        if (payload?.authenticated) {
          router.replace("/");
        }
      } catch {
        // ignore
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    };

    void verifySession();
    return () => {
      active = false;
    };
  }, [router]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isValidEmail(form.email) || form.password.length < 8) {
      toast({
        title: t("Input non valido", "Invalid input", "Entrée invalide", "Entrada no válida", "Ungültige Eingabe"),
        description: t("Inserisci una email valida e una password di almeno 8 caratteri.", "Enter a valid email and a password with at least 8 characters.", "Saisissez un email valide et un mot de passe d'au moins 8 caractères.", "Introduce un correo válido y una contraseña de al menos 8 caracteres.", "Gib eine gültige E-Mail und ein Passwort mit mindestens 8 Zeichen ein."),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        mode === "signin" ? "/api/auth/login" : "/api/auth/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            ...(mode === "signup" ? { name: form.name } : {}),
          }),
        }
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || t("Autenticazione non riuscita", "Authentication failed", "Échec de l'authentification", "Error de autenticación", "Authentifizierung fehlgeschlagen"));
      }

      router.push("/");
    } catch (error) {
      toast({
        title: t("Autenticazione non riuscita", "Authentication failed", "Échec de l'authentification", "Error de autenticación", "Authentifizierung fehlgeschlagen"),
        description: error instanceof Error ? error.message : t("Riprova", "Please try again", "Veuillez réessayer", "Por favor, inténtalo de nuevo", "Bitte erneut versuchen"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return null;
  }

  const submitLabelSignIn = t("Accedi", "Sign in", "Se connecter", "Iniciar sesión", "Anmelden");
  const submitLabelSignUp = t("Crea account", "Create account", "Créer un compte", "Crear cuenta", "Konto erstellen");

  return (
    <div className="min-h-screen w-full overflow-y-auto">
      <div className="absolute inset-0 -z-10 paper-grain text-foreground pointer-events-none" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 -z-10 h-[42rem] w-[42rem] rounded-full opacity-60 anim-aurora"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--primary), transparent 70%), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-[34rem] w-[34rem] rounded-full opacity-60 anim-aurora"
        style={{
          animationDelay: "-8s",
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--accent), transparent 60%), transparent 70%)",
        }}
      />

      <div className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-12 px-6 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-12 lg:py-16">
        <header className="absolute top-6 right-6 z-10 lg:top-8 lg:right-8">
          <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
            <SelectTrigger size="sm" aria-label={t("Lingua", "Language", "Langue", "Idioma", "Sprache")}>
              <Languages className="h-3.5 w-3.5 text-primary" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {UI_LANGUAGES.map((lang) => (
                <SelectItem key={lang} value={lang}>{UI_LANGUAGE_LABELS[lang]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        <section className="hidden flex-col justify-between lg:flex stagger" style={{ ["--i" as string]: 0 } as React.CSSProperties}>
          <div className="anim-fade-in-up" style={{ ["--i" as string]: 0 } as React.CSSProperties}>
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="status-dot text-primary anim-pulse-glow" />
              {t("OCR di documenti, accurato", "Document OCR, done right", "OCR de documents, juste", "OCR de documentos bien hecho", "Dokument-OCR, präzise")}
            </span>
          </div>

          <div className="space-y-6">
            <h1 className="font-display text-[5.5rem] leading-[0.9] font-semibold tracking-tight wordmark anim-fade-in-up" style={{ ["--i" as string]: 1 } as React.CSSProperties}>
              Extracto
              <span className="text-primary not-italic">.</span>
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground anim-fade-in-up" style={{ ["--i" as string]: 2 } as React.CSSProperties}>
              {t(
                "Estrai testo da PDF, immagini e scansioni. Batch, anteprime, post-elaborazione, esportazione verso vector store.",
                "Extract text from PDFs, images, and scans. Batch, previews, post-processing, vector-store export.",
                "Extrayez le texte de PDF, images et scans. Batch, aperçus, post-traitement, export vector-store.",
                "Extrae texto de PDF, imágenes y escaneos. Lotes, vistas previas, post-procesamiento, exportación a vector-store.",
                "Text aus PDFs, Bildern und Scans extrahieren. Stapel, Vorschauen, Nachverarbeitung, Vector-Store-Export.",
              )}
            </p>
          </div>

          <ul className="space-y-3 text-sm anim-fade-in-up" style={{ ["--i" as string]: 3 } as React.CSSProperties}>
            {[
              t("Provider Ollama, Mistral, OpenRouter, OpenAI-compatible", "Ollama, Mistral, OpenRouter, OpenAI-compatible providers"),
              t("Batch + checkpoint, riprendi qualsiasi job", "Batch + checkpoints, resume any job"),
              t("Esportazione verso Chroma per knowledge base", "Export to Chroma for knowledge base"),
            ].map((line, i) => (
              <li key={i} className="flex items-start gap-3 text-foreground/80">
                <span className="mt-[7px] inline-block size-1.5 rounded-full bg-primary" />
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex w-full max-w-md flex-col justify-center self-center lg:max-w-none lg:justify-self-end lg:max-w-[28rem]">
          <div className="surface-floating paper-grain rounded-[28px] p-8 anim-fade-in-up text-foreground" style={{ ["--i" as string]: 1 } as React.CSSProperties}>
            <div className="lg:hidden mb-6">
              <h1 className="wordmark font-display text-5xl leading-none tracking-tight">
                Extracto<span className="text-primary not-italic">.</span>
              </h1>
            </div>

            <div className="space-y-1.5">
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                {mode === "signin"
                  ? t("Bentornato", "Welcome back", "Bon retour", "Bienvenido de nuevo", "Willkommen zurück")
                  : t("Crea il tuo spazio", "Make it yours", "Faites-le vôtre", "Hazlo tuyo", "Mach es zu deinem")}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {mode === "signin"
                  ? t("Accedi per continuare con i tuoi documenti.", "Sign in to keep working on your documents.", "Connectez-vous pour reprendre vos documents.", "Inicia sesión para seguir con tus documentos.", "Melde dich an, um mit deinen Dokumenten fortzufahren.")
                  : t("Bastano email e password per iniziare.", "Just email and password to get started.", "Email et mot de passe suffisent pour commencer.", "Solo email y contraseña para empezar.", "E-Mail und Passwort reichen, um zu beginnen.")}
              </p>
            </div>

            <Tabs value={mode} onValueChange={(next) => setMode(next as "signin" | "signup")} className="mt-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">{t("Accedi", "Sign in", "Se connecter", "Iniciar sesión", "Anmelden")}</TabsTrigger>
                <TabsTrigger value="signup">{t("Registrati", "Sign up", "S'inscrire", "Registrarse", "Registrieren")}</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-5 space-y-4">
                <form className="space-y-4" onSubmit={submit}>
                  <FieldEmail
                    id="email"
                    label={t("Email", "Email", "Email", "Correo", "E-Mail")}
                    value={form.email}
                    onChange={(v) => setForm((c) => ({ ...c, email: v }))}
                  />
                  <FieldPassword
                    id="password"
                    label={t("Password", "Password", "Mot de passe", "Contraseña", "Passwort")}
                    value={form.password}
                    onChange={(v) => setForm((c) => ({ ...c, password: v }))}
                  />
                  <Button type="submit" disabled={loading} className="w-full group" size="lg">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{loading ? t("Accesso in corso...", "Signing in...", "Connexion...", "Iniciando sesión...", "Anmeldung...") : submitLabelSignIn}</span>
                    {!loading ? <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" /> : null}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-5 space-y-4">
                <form className="space-y-4" onSubmit={submit}>
                  <FieldText
                    id="name"
                    icon={User}
                    label={t("Nome", "Name", "Nom", "Nombre", "Name")}
                    value={form.name}
                    onChange={(v) => setForm((c) => ({ ...c, name: v }))}
                  />
                  <FieldEmail
                    id="signup-email"
                    label={t("Email", "Email", "Email", "Correo", "E-Mail")}
                    value={form.email}
                    onChange={(v) => setForm((c) => ({ ...c, email: v }))}
                  />
                  <FieldPassword
                    id="signup-password"
                    label={t("Password", "Password", "Mot de passe", "Contraseña", "Passwort")}
                    value={form.password}
                    onChange={(v) => setForm((c) => ({ ...c, password: v }))}
                    helper={t("Minimo 8 caratteri.", "Minimum 8 characters.", "Au moins 8 caractères.", "Mínimo 8 caracteres.", "Mindestens 8 Zeichen.")}
                  />
                  <Button type="submit" disabled={loading} className="w-full group" size="lg">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{loading ? t("Creazione account...", "Creating account...", "Création...", "Creando cuenta...", "Wird erstellt...") : submitLabelSignUp}</span>
                    {!loading ? <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" /> : null}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>

          <p className="mt-6 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
            {t("Privato per impostazione predefinita", "Private by default", "Privé par défaut", "Privado por defecto", "Standardmäßig privat")}
          </p>
        </section>
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
}

function FieldText({ id, label, value, onChange, icon: Icon, helper }: FieldProps & { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground/80">{label}</Label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
          autoComplete="name"
        />
      </div>
      {helper ? <p className="pl-1 text-[11px] text-muted-foreground/80">{helper}</p> : null}
    </div>
  );
}

function FieldEmail({ id, label, value, onChange, helper }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground/80">{label}</Label>
      <div className="relative">
        <Mail className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
        <Input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
        />
      </div>
      {helper ? <p className="pl-1 text-[11px] text-muted-foreground/80">{helper}</p> : null}
    </div>
  );
}

function FieldPassword({ id, label, value, onChange, helper }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground/80">{label}</Label>
      <div className="relative">
        <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
        />
      </div>
      {helper ? <p className="pl-1 text-[11px] text-muted-foreground/80">{helper}</p> : null}
    </div>
  );
}
