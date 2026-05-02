"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        "data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-full bg-secondary",
          "shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--foreground),transparent_92%)]",
          "data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full",
          "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5",
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute bg-primary",
            "data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(
            "block size-4 shrink-0 rounded-full bg-card",
            "shadow-[0_1px_3px_rgb(28_18_8/0.20),0_0_0_2px_var(--primary)]",
            "transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
            "hover:scale-110 hover:shadow-[0_2px_6px_rgb(28_18_8/0.25),0_0_0_2px_var(--primary),0_0_0_8px_color-mix(in_oklab,var(--primary),transparent_82%)]",
            "focus-visible:outline-none focus-visible:scale-110 focus-visible:shadow-[0_2px_6px_rgb(28_18_8/0.25),0_0_0_2px_var(--primary),0_0_0_8px_color-mix(in_oklab,var(--primary),transparent_75%)]",
            "active:scale-95",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
