"use client";

export const dynamic = "force-dynamic";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Plus,
  MessageSquare,
  Search,
  Trash2,
  ChevronLeft,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sidebar } from "@/components/sidebar";
import { ChatInterface } from "@/components/chat-interface";
import { NewChatDialog } from "@/components/new-chat-dialog";
import type { Conversation } from "@/lib/types";

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function ConversationItem({ conversation, isActive, onClick, onDelete }: ConversationItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="group relative"
    >
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
          isActive
            ? "bg-primary/10 border border-primary/30"
            : "hover:bg-secondary border border-transparent"
        )}
      >
        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("font-medium text-sm truncate", isActive && "text-primary")}>
            {conversation.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(conversation.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </button>
    </motion.div>
  );
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const fetchConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations`);
      const data = await response.json();
      if (data.success) {
        setConversations(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleCreateConversation = async (title: string, context?: Record<string, unknown>) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, context }),
      });
      const data = await response.json();
      if (data.success) {
        setActiveConversationId(data.data.conversationId);
        fetchConversations();
        setShowNewDialog(false);
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations/${id}`, {
        method: "DELETE",
      });
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
      fetchConversations();
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const filteredConversations = conversations.filter((conv) =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        className="w-64 shrink-0 hidden md:flex"
        activeTab="chat"
        onNewResearch={() => setShowNewDialog(true)}
        recentConversations={conversations.slice(0, 5)}
      />

      <main className="flex-1 flex overflow-hidden">
        <div
          className={cn(
            "flex flex-col border-r border-border/50 transition-all duration-300",
            activeConversationId ? "w-80 hidden lg:flex" : "w-full lg:w-80"
          )}
        >
          <div className="flex h-16 items-center justify-between px-4 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => router.push("/")}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-lg font-semibold">Chat</h1>
                <p className="text-xs text-muted-foreground">
                  {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setShowNewDialog(true)}>
              <Plus className="h-5 w-5" />
            </Button>
          </div>

          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Separator />

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-pulse space-y-3 w-full">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-14 bg-secondary rounded-lg" />
                    ))}
                  </div>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    {searchQuery ? "No conversations found" : "No conversations yet"}
                  </p>
                  {!searchQuery && (
                    <Button
                      variant="link"
                      onClick={() => setShowNewDialog(true)}
                      className="mt-2"
                    >
                      Start your first chat
                    </Button>
                  )}
                </div>
              ) : (
                filteredConversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={activeConversationId === conversation.id}
                    onClick={() => setActiveConversationId(conversation.id)}
                    onDelete={() => handleDeleteConversation(conversation.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeConversationId ? (
            <ChatInterface
              conversationId={activeConversationId}
              onBack={() => setActiveConversationId(null)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-gradient-to-r from-teal-500/20 to-cyan-500/20 blur-3xl rounded-full" />
                <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-2xl">
                  <Brain className="h-12 w-12 text-white" />
                </div>
              </div>
              <h2 className="text-3xl font-bold mb-3 gradient-text">
                DeepTick Chat
              </h2>
              <p className="text-muted-foreground max-w-md mb-6">
                Have intelligent conversations about your research. Ask follow-up questions,
                explore scenarios, and get deeper insights.
              </p>
              <Button
                onClick={() => setShowNewDialog(true)}
                className="gap-2 bg-gradient-to-r from-teal-600 to-cyan-600"
              >
                <Plus className="h-4 w-4" />
                New Conversation
              </Button>
            </div>
          )}
        </div>
      </main>

      <NewChatDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSubmit={handleCreateConversation}
      />
    </div>
  );
}
