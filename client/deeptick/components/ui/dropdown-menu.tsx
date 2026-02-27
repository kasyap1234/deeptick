import * as React from "react";
import { cn } from "@/lib/utils";

const DropdownMenuContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
} | null>(null);

const useDropdownMenu = () => {
  const context = React.useContext(DropdownMenuContext);
  if (!context) throw new Error("DropdownMenu components must be used within DropdownMenu");
  return context;
};

const DropdownMenu = ({ children, open: controlledOpen, onOpenChange }: { children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const handleOpenChange = React.useCallback((value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  }, [controlledOpen, onOpenChange]);

  React.useEffect(() => {
    const handleClickOutside = () => {
      if (isOpen) {
        handleOpenChange(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen, handleOpenChange]);

  return (
    <DropdownMenuContext.Provider value={{ open: isOpen, onOpenChange: handleOpenChange }}>
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  );
};

const DropdownMenuTrigger = ({ children }: { children: React.ReactNode }) => {
  const { onOpenChange, open } = useDropdownMenu();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenChange(!open);
      }}
      className="p-2 hover:bg-secondary rounded-md transition-colors"
    >
      {children}
    </button>
  );
};

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }
>(({ className, align = "start", ...props }, ref) => {
  const { open } = useDropdownMenu();
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-card p-1 text-card-foreground shadow-md",
        align === "end" ? "right-0" : "left-0",
        "top-full mt-1",
        className
      )}
      {...props}
    />
  );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
