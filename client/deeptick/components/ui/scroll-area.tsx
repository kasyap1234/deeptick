import * as React from "react";
import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: "vertical" | "horizontal" | "both";
  }
>(({ className, children, orientation = "vertical", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative overflow-hidden",
      orientation === "vertical" && "overflow-y-auto overflow-x-hidden",
      orientation === "horizontal" && "overflow-x-auto overflow-y-hidden",
      orientation === "both" && "overflow-auto",
      className
    )}
    {...props}
  >
    {children}
  </div>
));
ScrollArea.displayName = "ScrollArea";

export { ScrollArea };
