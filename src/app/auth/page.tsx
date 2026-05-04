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
import type { UiLanguage } from "@/app/page-components/types";

interface AuthFormState {
  email: string;
  password: string;
  name: string;
}

interface SessionResponse {
  authenticated?: boolean;
}

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
  const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("en");
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
    queueMicrotask(() => {
      try {
        const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
        if (isUiLanguage(storedLanguage)) {
          setUiLanguage(storedLanguage);
          return;
        }
        const browserLang = (navigator.language || "en").slice(0, 2).toLowerCase();
        if (isUiLanguage(browserLang)) {
          setUiLanguage(browserLang);
        }
      } catch {
        // ignore storage errors
      }
    });
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

    if (!isValidEmail(form.email) || form.password.length < 12) {
      toast({
        title: t("Controlla i dati", "Check your details", "Vérifiez les champs", "Revisa los datos", "Bitte prüfen"),
        description: t(
          "Servono un'email valida e una password di almeno 12 caratteri.",
          "We need a real email and a password of at least 12 characters.",
          "Il faut un email valide et un mot de passe d'au moins 12 caractères.",
          "Necesitamos un correo válido y una contraseña de al menos 12 caracteres.",
          "Eine gültige E-Mail und ein Passwort mit mindestens 12 Zeichen reichen.",
        ),
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
        throw new Error(payload.error || t("Non siamo riusciti ad accedere", "Couldn't sign you in", "Connexion impossible", "No pudimos iniciar sesión", "Anmeldung nicht möglich"));
      }

      router.push("/");
    } catch (error) {
      toast({
        title: t("Non siamo riusciti ad accedere", "Couldn't sign you in", "Connexion impossible", "No pudimos iniciar sesión", "Anmeldung nicht möglich"),
        description: error instanceof Error ? error.message : t(
          "Controlla email e password e prova ancora.",
          "Double-check your email and password and try again.",
          "Vérifiez votre email et votre mot de passe puis réessayez.",
          "Revisa tu correo y contraseña e inténtalo de nuevo.",
          "Prüfe E-Mail und Passwort und versuche es erneut.",
        ),
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

        <section className="hidden flex-col justify-center gap-8 lg:flex">
          <h1 className="font-display text-[6rem] leading-[0.92] font-semibold tracking-tight wordmark anim-fade-in-up">
            Extracto
            <span className="text-primary not-italic">.</span>
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-foreground/85 anim-fade-in-up" style={{ animationDelay: "120ms" } as React.CSSProperties}>
            {t(
              "Trasforma qualsiasi documento (PDF, foto, scansioni) in testo pulito e modificabile. Lavora in locale o nel cloud, conserva tabelle e formattazione, e archivia tutto dove ti serve.",
              "Turn any document (PDFs, photos, scans) into clean, editable text. Run it locally or in the cloud, keep tables and formatting intact, and ship it wherever you need.",
              "Transformez n'importe quel document (PDF, photos, scans) en texte propre et modifiable. Exécutez-le en local ou dans le cloud, conservez tableaux et mise en forme, et exportez-le où bon vous semble.",
              "Convierte cualquier documento (PDFs, fotos, escaneos) en texto limpio y editable. Ejecútalo en local o en la nube, conserva tablas y formato, y envíalo a donde lo necesites.",
              "Wandle jedes Dokument (PDFs, Fotos, Scans) in sauberen, bearbeitbaren Text um. Lokal oder in der Cloud, mit Tabellen und Formatierung intakt, und exportiere es überallhin.",
            )}
          </p>
        </section>

        <section className="flex w-full max-w-md flex-col justify-center self-center lg:max-w-none lg:justify-self-end lg:max-w-[28rem]">
          <div className="surface-floating paper-grain rounded-[28px] p-8 anim-fade-in-up text-foreground" style={{ ["--i" as string]: 1 } as React.CSSProperties}>
            <div className="lg:hidden mb-6 space-y-2">
              <h1 className="wordmark font-display text-5xl leading-tight tracking-tight inline-block pr-1.5">
                Extracto<span className="text-primary not-italic">.</span>
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(
                  "Trasforma documenti in testo pulito e modificabile.",
                  "Turn documents into clean, editable text.",
                  "Transformez vos documents en texte propre et modifiable.",
                  "Convierte documentos en texto limpio y editable.",
                  "Verwandle Dokumente in sauberen, bearbeitbaren Text.",
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                {mode === "signin"
                  ? t("Bentornato", "Welcome back", "Content de te revoir", "Bienvenido de nuevo", "Willkommen zurück")
                  : t("Apri un account", "Create your account", "Créer votre compte", "Crea tu cuenta", "Konto erstellen")}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {mode === "signin"
                  ? t(
                    "Accedi per riprendere da dove avevi lasciato.",
                    "Sign in to pick up right where you left off.",
                    "Connectez-vous pour reprendre là où vous vous étiez arrêté.",
                    "Inicia sesión para retomar donde lo dejaste.",
                    "Melde dich an, um genau dort weiterzumachen, wo du aufgehört hast.",
                  )
                  : t(
                    "Bastano un'email e una password. Niente carta, niente formalità.",
                    "Just an email and a password. No card, no fine print.",
                    "Une email et un mot de passe. Aucune carte, aucune formalité.",
                    "Solo un correo y una contraseña. Sin tarjeta, sin letra pequeña.",
                    "Nur E-Mail und Passwort. Keine Karte, kein Kleingedrucktes.",
                  )}
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
                    placeholder={t("Inserisci la tua password", "Enter your password", "Saisis ton mot de passe", "Introduce tu contraseña", "Passwort eingeben")}
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
                    placeholder={t("Il tuo nome", "Your name", "Votre nom", "Tu nombre", "Dein Name")}
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
                    helper={t("Minimo 12 caratteri.", "Minimum 12 characters.", "Au moins 12 caractères.", "Mínimo 12 caracteres.", "Mindestens 12 Zeichen.")}
                    placeholder={t("Almeno 12 caratteri", "At least 12 characters", "Au moins 12 caractères", "Al menos 12 caracteres", "Mindestens 12 Zeichen")}
                    autoComplete="new-password"
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
  placeholder?: string;
}

function FieldText({ id, label, value, onChange, icon: Icon, helper, placeholder }: FieldProps & { icon: React.ComponentType<{ className?: string }> }) {
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
          placeholder={placeholder}
        />
      </div>
      {helper ? <p className="pl-1 text-[11px] text-muted-foreground/80">{helper}</p> : null}
    </div>
  );
}

function FieldEmail({ id, label, value, onChange, helper, placeholder }: FieldProps) {
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
          placeholder={placeholder ?? "name@example.com"}
        />
      </div>
      {helper ? <p className="pl-1 text-[11px] text-muted-foreground/80">{helper}</p> : null}
    </div>
  );
}

function FieldPassword({ id, label, value, onChange, helper, placeholder, autoComplete = "current-password" }: FieldProps & { autoComplete?: "current-password" | "new-password" }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wider text-muted-foreground/80">{label}</Label>
      <div className="relative">
        <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
        <Input
          id={id}
          type="password"
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-10"
          placeholder={placeholder}
        />
      </div>
      {helper ? <p className="pl-1 text-[11px] text-muted-foreground/80">{helper}</p> : null}
    </div>
  );
}
