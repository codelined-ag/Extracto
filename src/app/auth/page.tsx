"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border-2">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t("Accesso Extracto", "Extracto Access", "Accès Extracto", "Acceso a Extracto", "Extracto-Zugang")}</CardTitle>
            <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
              <SelectTrigger className="w-[90px] h-8" aria-label={t("Lingua", "Language", "Langue", "Idioma", "Sprache")}>
                <div className="flex items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5 text-primary" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="it">IT</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardDescription>
            {t("Accedi o crea un account gratuito per usare l'OCR.", "Sign in or create a free account to access OCR.", "Connectez-vous ou créez un compte gratuit pour utiliser l'OCR.", "Inicia sesión o crea una cuenta gratis para usar OCR.", "Anmelden oder kostenloses Konto erstellen, um OCR zu nutzen.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(next) => setMode(next as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t("Accedi", "Sign In", "Se connecter", "Iniciar sesión", "Anmelden")}</TabsTrigger>
              <TabsTrigger value="signup">{t("Registrati", "Sign Up", "S'inscrire", "Registrarse", "Registrieren")}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4 space-y-4">
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t("Password", "Password", "Mot de passe", "Contraseña", "Passwort")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, password: event.target.value }))
                    }
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? t("Accesso in corso...", "Signing in...", "Connexion en cours...", "Iniciando sesión...", "Anmeldung läuft...") : t("Accedi", "Sign In", "Se connecter", "Iniciar sesión", "Anmelden")}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4 space-y-4">
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="name">{t("Nome", "Name", "Nom", "Nombre", "Name")}</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">{t("Email", "Email", "Email", "Correo", "E-Mail")}</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">{t("Password", "Password", "Mot de passe", "Contraseña", "Passwort")}</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, password: event.target.value }))
                    }
                  />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? t("Creazione account...", "Creating account...", "Création du compte...", "Creando cuenta...", "Konto wird erstellt...") : t("Crea account gratuito", "Create Free Account", "Créer un compte gratuit", "Crear cuenta gratis", "Kostenloses Konto erstellen")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
