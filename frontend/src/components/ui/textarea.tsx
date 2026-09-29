import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(
  ({ className, ...props }, ref) => {
  return (
    (<textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border border-border-subtle bg-surface-subtle/90 px-3 py-2 text-sm text-copy-primary shadow-xs transition-all duration-200 placeholder:text-copy-tertiary focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:bg-surface hover:shadow-sm disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-copy-disabled",
        className
      )}
      ref={ref}
      {...props} />)
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
