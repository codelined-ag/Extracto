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
import { useToast } from "@/hooks/use-toast";

import type { Translator } from "@/app/page-components/types";

const MIN_PASSWORD_LENGTH = 12;

export interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Translator;
}

export function ChangePasswordDialog({ open, onOpenChange, t }: ChangePasswordDialogProps) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const errorTitle = t(
    "Cambio password non riuscito",
    "Failed to change password",
    "Échec du changement de mot de passe",
    "Error al cambiar la contraseña",
    "Passwortänderung fehlgeschlagen",
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: errorTitle,
        description: t(
          `La nuova password deve essere di almeno ${MIN_PASSWORD_LENGTH} caratteri`,
          `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
          `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères`,
          `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
          `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`,
        ),
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: errorTitle,
        description: t(
          "Le password non coincidono",
          "Passwords do not match",
          "Les mots de passe ne correspondent pas",
          "Las contraseñas no coinciden",
          "Passwörter stimmen nicht überein",
        ),
        variant: "destructive",
      });
      return;
    }

    if (currentPassword === newPassword) {
      toast({
        title: errorTitle,
        description: t(
          "La nuova password deve essere diversa da quella attuale",
          "New password must be different from the current password",
          "Le nouveau mot de passe doit différer de l'actuel",
          "La nueva contraseña debe ser diferente de la actual",
          "Das neue Passwort muss sich vom aktuellen unterscheiden",
        ),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: errorTitle,
          description: data?.error || errorTitle,
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }
      toast({
        title: t(
          "Password aggiornata",
          "Password updated",
          "Mot de passe mis à jour",
          "Contraseña actualizada",
          "Passwort aktualisiert",
        ),
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: errorTitle,
        description: error instanceof Error ? error.message : "",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {t(
              "Cambia password",
              "Change password",
              "Changer le mot de passe",
              "Cambiar contraseña",
              "Passwort ändern",
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              `La nuova password deve essere di almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
              `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
              `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
              `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
              `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">
              {t(
                "Password attuale",
                "Current password",
                "Mot de passe actuel",
                "Contraseña actual",
                "Aktuelles Passwort",
              )}
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">
              {t(
                "Nuova password",
                "New password",
                "Nouveau mot de passe",
                "Nueva contraseña",
                "Neues Passwort",
              )}
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">
              {t(
                "Conferma nuova password",
                "Confirm new password",
                "Confirmer le nouveau mot de passe",
                "Confirmar nueva contraseña",
                "Neues Passwort bestätigen",
              )}
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("Annulla", "Cancel", "Annuler", "Cancelar", "Abbrechen")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <LoaderCircleIcon size={16} className="mr-2 animate-spin" />
              ) : null}
              {t("Aggiorna", "Update", "Mettre à jour", "Actualizar", "Aktualisieren")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
