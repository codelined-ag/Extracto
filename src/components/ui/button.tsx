import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap select-none",
    "rounded-xl text-sm font-medium tracking-tight",
    "transition-[transform,box-shadow,background-color,color] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
    "outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary),transparent_78%),inset_0_0_0_1px_color-mix(in_oklab,var(--primary),transparent_60%)]",
    "active:translate-y-[0.5px]",
  ),
  {
    variants: {
      variant: {
        default: cn(
          "bg-primary text-primary-foreground",
          "shadow-[0_1px_2px_-1px_rgb(28_18_8/0.10),0_6px_18px_-8px_color-mix(in_oklab,var(--primary),transparent_55%)]",
          "hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--primary),black_4%)] hover:shadow-[0_2px_4px_-2px_rgb(28_18_8/0.10),0_14px_30px_-10px_color-mix(in_oklab,var(--primary),transparent_45%)]",
        ),
        destructive: cn(
          "bg-destructive text-white",
          "shadow-[0_1px_2px_-1px_rgb(28_18_8/0.10),0_6px_18px_-8px_color-mix(in_oklab,var(--destructive),transparent_55%)]",
          "hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--destructive),black_4%)] hover:shadow-[0_2px_4px_-2px_rgb(28_18_8/0.10),0_14px_30px_-10px_color-mix(in_oklab,var(--destructive),transparent_40%)]",
        ),
        outline: cn(
          "bg-secondary/60 text-foreground backdrop-blur-sm",
          "shadow-[var(--shadow-soft)]",
          "hover:-translate-y-px hover:bg-secondary hover:shadow-[var(--shadow-lift)]",
        ),
        secondary: cn(
          "bg-secondary text-secondary-foreground",
          "shadow-[var(--shadow-soft)]",
          "hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--secondary),var(--accent)_35%)] hover:shadow-[var(--shadow-lift)]",
        ),
        ghost: cn(
          "bg-transparent text-foreground/80",
          "hover:bg-secondary/70 hover:text-foreground",
        ),
        link: "text-primary underline-offset-4 hover:underline decoration-primary/40 hover:decoration-primary",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-2xl px-6 has-[>svg]:px-5 text-[0.95rem]",
        icon: "size-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
