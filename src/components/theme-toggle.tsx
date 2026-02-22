"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"

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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 relative overflow-hidden"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <motion.div
          initial={false}
          animate={{
            rotate: theme === "dark" ? 0 : 180,
            scale: theme === "dark" ? 1 : 0,
          }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="absolute"
        >
          <Moon className="h-4 w-4" />
        </motion.div>
        <motion.div
          initial={false}
          animate={{
            rotate: theme === "light" ? 0 : -180,
            scale: theme === "light" ? 1 : 0,
          }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="absolute"
        >
          <Sun className="h-4 w-4" />
        </motion.div>
        <span className="sr-only">Toggle theme</span>
      </Button>
    </motion.div>
  )
}
