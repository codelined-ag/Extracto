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

type UiLanguage = "it" | "en";
const UI_LANGUAGE_STORAGE_KEY = "extracto:ui-language:v1";

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
    (it: string, en: string) => (uiLanguage === "it" ? it : en),
    [uiLanguage]
  );

  React.useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
      if (storedLanguage === "it" || storedLanguage === "en") {
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
        title: t("Input non valido", "Invalid input"),
        description: t("Inserisci una email valida e una password di almeno 8 caratteri.", "Enter a valid email and a password with at least 8 characters."),
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
        throw new Error(payload.error || t("Autenticazione non riuscita", "Authentication failed"));
      }

      router.push("/");
    } catch (error) {
      toast({
        title: t("Autenticazione non riuscita", "Authentication failed"),
        description: error instanceof Error ? error.message : t("Riprova", "Please try again"),
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
            <CardTitle>{t("Accesso Extracto", "Extracto Access")}</CardTitle>
            <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
              <SelectTrigger className="w-[90px] h-8" aria-label={t("Lingua", "Language")}>
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
            {t("Accedi o crea un account gratuito per usare l'OCR.", "Sign in or create a free account to access OCR.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(next) => setMode(next as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t("Accedi", "Sign In")}</TabsTrigger>
              <TabsTrigger value="signup">{t("Registrati", "Sign Up")}</TabsTrigger>
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
                  <Label htmlFor="password">{t("Password", "Password")}</Label>
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
                  {loading ? t("Accesso in corso...", "Signing in...") : t("Accedi", "Sign In")}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4 space-y-4">
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="name">{t("Nome", "Name")}</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">{t("Email", "Email")}</Label>
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
                  <Label htmlFor="signup-password">{t("Password", "Password")}</Label>
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
                  {loading ? t("Creazione account...", "Creating account...") : t("Crea account gratuito", "Create Free Account")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
