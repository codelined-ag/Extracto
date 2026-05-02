import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-1 px-2 py-0.5 text-[11px] font-medium tracking-wide w-fit whitespace-nowrap shrink-0 overflow-hidden",
    "rounded-full",
    "transition-[color,background-color,transform] duration-200",
    "[&>svg]:size-3 [&>svg]:pointer-events-none",
  ),
  {
    variants: {
      variant: {
        default: "bg-primary/12 text-primary [a&]:hover:bg-primary/20",
        secondary: "bg-secondary text-secondary-foreground/80 [a&]:hover:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_25%)]",
        destructive: "bg-destructive/12 text-destructive [a&]:hover:bg-destructive/20",
        outline: "bg-transparent text-foreground/80 [a&]:hover:bg-secondary",
        accent: "bg-accent text-accent-foreground [a&]:hover:bg-[color-mix(in_oklab,var(--accent),var(--primary)_18%)]",
        solid: "bg-primary text-primary-foreground [a&]:hover:bg-[color-mix(in_oklab,var(--primary),black_4%)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
