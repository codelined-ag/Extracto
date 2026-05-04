"use client";

import { motion } from "motion/react";

import { Card, CardContent } from "@/components/ui/card";

import type { Translator } from "@/app/page-components/types";

export interface NoSelectionCardProps {
  t: Translator;
}

export function NoSelectionCard({ t }: NoSelectionCardProps) {
  return (
    <Card className="flex-1 flex items-center justify-center">
      <CardContent className="text-center py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="w-24 h-24 mx-auto flex items-end justify-center">
            <img
              src="/document.gif"
              alt=""
              aria-hidden="true"
              className="max-w-full max-h-full object-contain"
            />
          </div>
          <h3 className="text-lg font-semibold mt-1 mb-2">
            {t(
              "Seleziona un documento",
              "Select a document",
              "Choisir un document",
              "Selecciona un documento",
              "Dokument wählen",
            )}
          </h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {t(
              "Carica file e selezionane uno per vedere il risultato OCR",
              "Upload files and select one to view the OCR extraction results",
              "Téléversez des fichiers et sélectionnez-en un pour voir le résultat OCR",
              "Sube archivos y selecciona uno para ver el resultado del OCR",
              "Dateien hochladen und eine auswählen, um das OCR-Ergebnis zu sehen",
            )}
          </p>
        </motion.div>
      </CardContent>
    </Card>
  );
}
