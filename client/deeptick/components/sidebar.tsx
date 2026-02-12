"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Brain,
  MessageSquare,
  Plus,
  Search,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  icon: React.ReactNode;
  label: string;
  href: string;
}

interface SidebarProps {
  className?: string;
  activeTab?: string;
  onNewResearch?: () => void;
  recentConversations?: Array<{ id: string; title: string; updatedAt: string }>;
}

const mainNavItems: NavItem[] = [
  { icon: <Brain className="h-4 w-4" />, label: "Research", href: "/" },
  { icon: <MessageSquare className="h-4 w-4" />, label: "Chat", href: "/chat" },
];

function ThemeToggleButton() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    const checkDark = () => document.documentElement.classList.contains("dark");
    setIsDark(checkDark());
    
    const observer = new MutationObserver(() => {
      setIsDark(checkDark());
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    
    return () => observer.disconnect();
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    if (html.classList.contains("dark")) {
      html.classList.remove("dark");
      localStorage.setItem("deeptick-theme", "light");
    } else {
      html.classList.add("dark");
      localStorage.setItem("deeptick-theme", "dark");
    }
  };

  if (!mounted) {
    return <div className="w-9 h-9 rounded-md border border-border" />;
  }

  return (
    <button
      onClick={toggleTheme}
      className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border bg-background hover:bg-accent transition-colors"
      aria-label="Toggle theme"
    >
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}

export function Sidebar({
  className,
  activeTab = "research",
  onNewResearch,
  recentConversations = [],
}: SidebarProps) {
  const [isCollapsed] = useState(false);

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex h-screen flex-col border-r border-border bg-background",
        className
      )}
    >
      <div className="flex h-14 items-center justify-between px-4 border-b border-border">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-foreground bg-foreground">
            <Brain className="h-3.5 w-3.5 text-background" />
          </div>
          <span className={cn("font-semibold text-sm tracking-tight", isCollapsed && "hidden")}>
            DeepTick
          </span>
        </Link>
        <ThemeToggleButton />
      </div>

      <div className="p-3">
        <Button
          onClick={onNewResearch}
          className="w-full gap-2 bg-foreground text-background hover:bg-foreground/90"
        >
          <Plus className="h-4 w-4" />
          {!isCollapsed && "New Research"}
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="flex flex-col gap-0.5">
          {mainNavItems.map((item) => (
            <Link key={item.label} href={item.href}>
              <Button
                variant={activeTab === item.label.toLowerCase() ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start gap-2 h-9 text-sm",
                  activeTab === item.label.toLowerCase() &&
                    "bg-secondary text-foreground"
                )}
              >
                {item.icon}
                {!isCollapsed && (
                  <span className="flex-1 text-left">{item.label}</span>
                )}
              </Button>
            </Link>
          ))}
        </nav>

        {recentConversations.length > 0 && !isCollapsed && (
          <>
            <Separator className="my-3" />
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-xs font-medium text-muted-foreground">
                Recent
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Search className="h-3 w-3" />
              </Button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {recentConversations.slice(0, 5).map((conv) => (
                <Link key={conv.id} href={`/chat/${conv.id}`}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 h-8 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1 text-left">{conv.title}</span>
                    <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  </Button>
                </Link>
              ))}
            </nav>
          </>
        )}
      </ScrollArea>

      <div className="border-t border-border p-3">
        <p className="text-[10px] text-muted-foreground text-center">
          DeepTick Research
        </p>
      </div>
    </motion.aside>
  );
}
