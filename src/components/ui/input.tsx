import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-xl px-3.5 py-2 text-sm md:text-sm",
        "bg-secondary text-foreground placeholder:text-muted-foreground/80",
        "selection:bg-primary/25 selection:text-foreground",
        "shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
        "transition-[box-shadow,background-color,color] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
        "outline-none",
        "hover:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_15%)]",
        "focus-visible:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_20%)] focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--primary),transparent_75%),inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
        "file:inline-flex file:h-7 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--destructive),transparent_55%)]",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
