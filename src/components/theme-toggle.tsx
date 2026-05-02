"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9">
        <span className="sr-only">Toggle theme</span>
      </Button>
    )
  }

  const isDark = theme === "dark"

  return (
    <div className="transition-[transform,opacity] duration-200 opacity-100 scale-100">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 relative overflow-hidden"
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        {/* Moon icon — visible in dark mode */}
        <div
          className={[
            "absolute transition-[transform,opacity] duration-300 ease-in-out",
            isDark
              ? "scale-100 opacity-100 rotate-0"
              : "scale-0 opacity-0 rotate-180",
          ].join(" ")}
        >
          <Moon className="h-4 w-4" />
        </div>
        {/* Sun icon — visible in light mode */}
        <div
          className={[
            "absolute transition-[transform,opacity] duration-300 ease-in-out",
            isDark
              ? "scale-0 opacity-0 -rotate-180"
              : "scale-100 opacity-100 rotate-0",
          ].join(" ")}
        >
          <Sun className="h-4 w-4" />
        </div>
        <span className="sr-only">Toggle theme</span>
      </Button>
    </div>
  )
}
