/**
 * Progress Component (shadcn/ui)
 * Displays progress indicators
 */

"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
  }
>(({ className, indicatorClassName, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full w-full flex-1 bg-primary transition-all",
        indicatorClassName,
      )}
      // A non-finite `value` (e.g. NaN from `undefined / undefined * 100`)
      // would render the literal string "NaN" into the transform and warn
      // "Received NaN for the children attribute". Clamp to 0-100.
      style={{
        transform: `translateX(-${
          100 -
          (Number.isFinite(value)
            ? Math.min(100, Math.max(0, value as number))
            : 0)
        }%)`,
      }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
