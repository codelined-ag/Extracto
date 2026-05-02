"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5",
        "bg-secondary data-[state=checked]:bg-primary",
        "shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
        "transition-[background-color,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
        "outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary),transparent_78%),inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-card",
          "shadow-[0_1px_3px_rgb(28_18_8/0.18),0_1px_2px_rgb(28_18_8/0.10)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[calc(100%-0.25rem)]",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
