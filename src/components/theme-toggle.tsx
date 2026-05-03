"use client"

import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { SunIcon } from "@/components/ui/sun"
import { MoonIcon } from "@/components/ui/moon"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = theme !== undefined

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9">
        <span className="sr-only">Toggle theme</span>
      </Button>
    )
  }

  const isDark = theme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-foreground/80 hover:text-primary"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <span className="sr-only">Toggle theme</span>
      {isDark ? (
        <MoonIcon size={16} className="inline-flex items-center justify-center" />
      ) : (
        <SunIcon size={16} className="inline-flex items-center justify-center" />
      )}
    </Button>
  )
}
