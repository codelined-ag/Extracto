import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-xl px-3.5 py-2.5 text-sm md:text-sm",
        "bg-secondary text-foreground placeholder:text-muted-foreground/80",
        "shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
        "transition-[box-shadow,background-color,color] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
        "outline-none",
        "hover:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_15%)]",
        "focus-visible:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_20%)] focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--primary),transparent_75%),inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--destructive),transparent_55%)]",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
