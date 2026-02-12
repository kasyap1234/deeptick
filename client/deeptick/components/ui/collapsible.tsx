"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

const Collapsible = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
  }
>(({ className, open: controlledOpen, defaultOpen, onOpenChange, children, ...props }, ref) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen || false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = React.useCallback((newOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  }, [controlledOpen, onOpenChange]);

  const contextValue = React.useMemo(() => ({
    open: isOpen,
    onOpenChange: handleOpenChange,
  }), [isOpen, handleOpenChange]);

  return (
    <CollapsibleContext.Provider value={contextValue}>
      <div ref={ref} className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
});
Collapsible.displayName = "Collapsible";

const CollapsibleContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
} | null>(null);

const useCollapsible = () => {
  const context = React.useContext(CollapsibleContext);
  if (!context) {
    throw new Error("Collapsible components must be used within a Collapsible provider");
  }
  return context;
};

const CollapsibleTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
  const { open, onOpenChange } = useCollapsible();

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpenChange(!open)}
      className={cn(
        "flex w-full items-center justify-between text-left",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className={cn(
          "h-4 w-4 shrink-0 transition-transform duration-200",
          open && "rotate-180"
        )}
      />
    </button>
  );
});
CollapsibleTrigger.displayName = "CollapsibleTrigger";

const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { open } = useCollapsible();

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden transition-all data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
CollapsibleContent.displayName = "CollapsibleContent";

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
};
