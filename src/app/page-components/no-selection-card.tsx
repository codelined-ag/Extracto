import { motion } from "framer-motion";

import { Card, CardContent } from "@/components/ui/card";
import { SparklesIcon } from "@/components/ui/sparkles";

import type { Translator } from "@/app/page-components/types";

export function NoSelectionCard({ t }: { t: Translator }) {
  return (
    <Card className="flex-1 flex items-center justify-center">
      <CardContent className="text-center py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center text-primary">
            <SparklesIcon size={48} className="inline-flex items-center justify-center" />
          </div>
          <h3 className="text-lg font-semibold mb-2">
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
