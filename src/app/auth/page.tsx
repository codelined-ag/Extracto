"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function AuthPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState<AuthFormState>({
    email: "",
    password: "",
    name: "",
  });
  const [authChecked, setAuthChecked] = React.useState(false);

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
        title: "Invalid input",
        description: "Enter a valid email and a password with at least 8 characters.",
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
        throw new Error(payload.error || "Authentication failed");
      }

      router.push("/");
    } catch (error) {
      toast({
        title: "Authentication failed",
        description: error instanceof Error ? error.message : "Please try again",
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
          <CardTitle>Estracto Auth</CardTitle>
          <CardDescription>
            Sign in or create a free account to access OCR.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(next) => setMode(next as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
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
                  <Label htmlFor="password">Password</Label>
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
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4 space-y-4">
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
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
                  <Label htmlFor="signup-password">Password</Label>
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
                  {loading ? "Creating account..." : "Create Free Account"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
