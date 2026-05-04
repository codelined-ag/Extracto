"use client";

import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { KeyRoundIcon } from "lucide-react";
import { LogoutIcon } from "@/components/ui/logout";
import { SettingsIcon } from "@/components/ui/settings";
import { UserIcon } from "@/components/ui/user";

import { ThemeToggle } from "@/components/theme-toggle";

import type { SettingsTab, Translator } from "@/app/page-components/types";

export interface HeaderBarProps {
  t: Translator;
  onOpenSettings: (tab: SettingsTab) => void;
  onChangePassword: () => void;
  onSignOut: () => void;
  isSigningOut: boolean;
}

export function HeaderBar({
  t,
  onOpenSettings,
  onChangePassword,
  onSignOut,
  isSigningOut,
}: HeaderBarProps) {
  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      className="sticky top-0 z-50 bg-background/75 backdrop-blur-md"
    >
      <div className="container mx-auto px-3 sm:px-5 h-16 flex items-center justify-between gap-2">
        <motion.div
          className="flex items-center gap-3 group"
          whileHover={{ scale: 1.015 }}
          transition={{ type: "spring", stiffness: 400, damping: 24 }}
        >
          <div className="flex items-baseline gap-0.5 overflow-visible">
            <span className="wordmark font-display text-2xl leading-tight inline-block pr-1.5 overflow-visible">
              Extracto
            </span>
            <span className="font-display italic text-2xl leading-tight text-primary inline-block">.</span>
          </div>
        </motion.div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.div
                whileHover={{ y: -1, scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.16 }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="group"
                  onClick={() => onOpenSettings("model")}
                  aria-label={t("Impostazioni", "Settings", "Paramètres", "Configuración", "Einstellungen")}
                >
                  <SettingsIcon
                    size={16}
                    className="inline-flex items-center justify-center text-foreground/80 transition-transform duration-300 group-hover:rotate-90 group-hover:text-primary"
                  />
                </Button>
              </motion.div>
            </TooltipTrigger>
            <TooltipContent>
              {t("Impostazioni", "Settings", "Paramètres", "Configuración", "Einstellungen")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <ThemeToggle />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("Cambia tema", "Toggle theme", "Changer de thème", "Cambiar tema", "Theme wechseln")}
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="group"
                    aria-label={t("Account", "Account", "Compte", "Cuenta", "Konto")}
                  >
                    <UserIcon
                      size={16}
                      className="inline-flex items-center justify-center text-foreground/80 group-hover:text-primary"
                    />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("Account", "Account", "Compte", "Cuenta", "Konto")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <DropdownMenuItem onSelect={onChangePassword}>
                <KeyRoundIcon size={16} className="inline-flex" />
                <span>
                  {t(
                    "Cambia password",
                    "Change password",
                    "Changer le mot de passe",
                    "Cambiar contraseña",
                    "Passwort ändern",
                  )}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onSignOut} disabled={isSigningOut}>
                <LogoutIcon size={16} className="inline-flex" />
                <span>{t("Esci", "Sign out", "Se déconnecter", "Cerrar sesión", "Abmelden")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.header>
  );
}
