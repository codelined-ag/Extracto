"use client";

import * as React from "react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiKeysSection } from "@/app/page-components/api-keys-section";
import { NotificationsSection } from "@/app/page-components/notifications-section";
import { UsageSection } from "@/app/page-components/usage-section";
import {
  SettingsAccordion,
  SettingsAccordionItem,
} from "@/app/page-components/settings-accordion";
import {
  UI_LANGUAGES,
  UI_LANGUAGE_FLAGS,
  UI_LANGUAGE_LABELS,
} from "@/app/page-components/ui-language";
import type { Translator, UiLanguage } from "@/app/page-components/types";

export interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Translator;
  uiLanguage: UiLanguage;
  setUiLanguage: (lang: UiLanguage) => void;
  onRestartTour?: () => void;
}

export function AccountDialog({ open, onOpenChange, t, uiLanguage, setUiLanguage, onRestartTour }: AccountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] !max-w-2xl max-h-[92vh] flex flex-col overflow-hidden p-0">
        <div className="px-6 pt-6 pb-3">
          <DialogHeader>
            <DialogTitle>{t("Il tuo account", "Your account", "Votre compte", "Tu cuenta", "Dein Konto")}</DialogTitle>
            <DialogDescription>
              {t(
                "Lingua, chiavi API, notifiche e statistiche personali.",
                "Language, API keys, notifications, and personal stats.",
                "Langue, clés API, notifications et statistiques personnelles.",
                "Idioma, claves API, notificaciones y estadísticas personales.",
                "Sprache, API-Schlüssel, Benachrichtigungen und persönliche Statistiken.",
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-6 pb-2">
          <div className="pt-2">
            <SettingsAccordion defaultOpen="language" storageKey="extracto.account.open">
              <SettingsAccordionItem
                value="language"
                title={t("Lingua interfaccia", "Interface language", "Langue de l'interface", "Idioma de la interfaz", "Oberflächensprache")}
                hint={t(
                  "Cambia la lingua dei testi dell'app.",
                  "Change the language of the app interface.",
                  "Modifie la langue de l'interface.",
                  "Cambia el idioma de la interfaz.",
                  "Sprache der App-Oberfläche ändern.",
                )}
              >
                <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden>{UI_LANGUAGE_FLAGS[uiLanguage]}</span>
                        <span>{UI_LANGUAGE_LABELS[uiLanguage]}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {UI_LANGUAGES.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden>{UI_LANGUAGE_FLAGS[lang]}</span>
                          <span>{UI_LANGUAGE_LABELS[lang]}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsAccordionItem>

              <SettingsAccordionItem
                value="keys"
                title={t("Chiavi API", "API keys", "Clés API", "Claves API", "API-Schlüssel")}
                hint={t(
                  "Per integrare Extracto in script o altri sistemi via bearer token.",
                  "For integrating Extracto into scripts or other systems via bearer token.",
                  "Pour intégrer Extracto dans des scripts ou d'autres systèmes via bearer token.",
                  "Para integrar Extracto en scripts u otros sistemas con bearer token.",
                  "Zum Einbinden von Extracto in Skripte oder andere Systeme per Bearer-Token.",
                )}
              >
                <ApiKeysSection t={t} />
              </SettingsAccordionItem>

              <SettingsAccordionItem
                value="push"
                title={t("Notifiche push", "Push notifications", "Notifications push", "Notificaciones push", "Push-Benachrichtigungen")}
                hint={t(
                  "Ricevi un avviso quando un job OCR finisce.",
                  "Get a ping when an OCR job finishes.",
                  "Recevez une alerte quand un job OCR se termine.",
                  "Recibe un aviso cuando termine un trabajo OCR.",
                  "Erhalte eine Benachrichtigung, wenn ein OCR-Job fertig ist.",
                )}
              >
                <NotificationsSection t={t} />
              </SettingsAccordionItem>

              <SettingsAccordionItem
                value="usage"
                title={t("Utilizzo", "Usage", "Utilisation", "Uso", "Nutzung")}
                hint={t(
                  "Statistiche delle tue chiamate OCR.",
                  "Stats for your OCR calls.",
                  "Statistiques de vos appels OCR.",
                  "Estadísticas de tus llamadas OCR.",
                  "Statistiken zu deinen OCR-Aufrufen.",
                )}
              >
                <UsageSection t={t} />
              </SettingsAccordionItem>
            </SettingsAccordion>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 hairline-t flex flex-row sm:flex-row sm:justify-between gap-2">
          {onRestartTour ? (
            <Button variant="ghost" onClick={onRestartTour}>
              {t("Rivedi il tour", "Replay tour", "Revoir la visite", "Repetir el tour", "Tour wiederholen")}
            </Button>
          ) : <span />}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Chiudi", "Close", "Fermer", "Cerrar", "Schließen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
