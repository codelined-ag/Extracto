"use client";

import { motion } from "motion/react";

import { GithubIcon } from "@/components/ui/github";

import type { Translator } from "@/app/page-components/types";

export interface FooterProps {
  t: Translator;
}

export function Footer({ t }: FooterProps) {
  return (
    <motion.footer
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="mt-auto"
    >
      <div className="container mx-auto px-3 sm:px-5 min-h-14 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground inline-flex items-center flex-wrap gap-1">
          <span>©&nbsp;{new Date().getFullYear()}</span>
          <span className="font-display italic font-medium text-foreground/80">Extracto</span>
          <span>{t("di", "by", "par", "por", "von")}</span>
          <a
            href="https://github.com/codelined-ag"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-foreground/80 hover:text-primary transition-colors group"
          >
            <span className="font-medium">codelined</span>
            <GithubIcon
              size={12}
              className="inline-flex items-center justify-center transition-transform duration-200 group-hover:rotate-6 group-hover:scale-110"
            />
          </a>
        </div>
        <a
          href="https://github.com/codelined-ag/Extracto"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 hover:text-primary transition-colors"
        >
          github
        </a>
      </div>
    </motion.footer>
  );
}
