"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  ChevronLeft,
  MoreVertical,
  Trash2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message, Conversation, StreamChunk } from "@/lib/types";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-3 p-4", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <Avatar className={cn("h-8 w-8 shrink-0", isUser ? "bg-primary" : "bg-secondary")}>
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-gradient-to-br from-teal-500 to-cyan-500"}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-white" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex flex-col gap-1 max-w-[80%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border border-border/50 rounded-bl-sm"
          )}
        >
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {isStreaming && !isUser && (
            <span className="inline-flex gap-1 ml-1">
              <span className="typing-dot w-1.5 h-1.5 bg-current rounded-full" />
              <span className="typing-dot w-1.5 h-1.5 bg-current rounded-full" />
              <span className="typing-dot w-1.5 h-1.5 bg-current rounded-full" />
            </span>
          )}
        </div>

        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.sources.map((source, idx) => (
              <a
                key={idx}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <span className="truncate max-w-[150px]">{source.title}</span>
              </a>
            ))}
          </div>
        )}

        <span className="text-[10px] text-muted-foreground">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </motion.div>
  );
}

interface ChatInterfaceProps {
  conversationId?: string;
  onBack?: () => void;
}

export function ChatInterface({ conversationId, onBack }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const connectWebSocket = useCallback((convId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    const wsUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") || "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws/chat/${convId}`);

    ws.onopen = () => {
      console.log("Chat WebSocket connected");
    };

    ws.onmessage = (event) => {
      const data: { type: string; content?: string; messageId?: string; isComplete?: boolean; sources?: Array<{ url: string; title: string }> } = JSON.parse(event.data);

      if (data.type === "stream_chunk") {
        setStreamingContent((prev) => prev + (data.content || ""));
        scrollToBottom();
      } else if (data.type === "stream_complete") {
        if (data.content) {
          const newMessage: Message = {
            id: data.messageId || crypto.randomUUID(),
            conversationId: convId,
            role: "assistant",
            content: streamingContent + (data.content || ""),
            sources: data.sources,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, newMessage]);
          setStreamingContent("");
        }
        setIsLoading(false);
      } else if (data.type === "error") {
        console.error("Chat error:", data);
        setIsLoading(false);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setIsLoading(false);
    };

    ws.onclose = () => {
      console.log("Chat WebSocket closed");
    };

    wsRef.current = ws;
  }, [streamingContent, scrollToBottom]);

  useEffect(() => {
    if (conversationId) {
      fetchConversation(conversationId);
      fetchMessages(conversationId);
      connectWebSocket(conversationId);
    }

    return () => {
      wsRef.current?.close();
    };
  }, [conversationId, connectWebSocket]);

  const fetchConversation = async (id: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations/${id}`);
      const data = await response.json();
      if (data.success) {
        setConversation(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch conversation:", error);
    }
  };

  const fetchMessages = async (id: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations/${id}/messages`);
      const data = await response.json();
      if (data.success) {
        setMessages(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !conversationId || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content: userMessage.content }));
    } else {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: userMessage.content }),
        });
        const data = await response.json();
        if (data.success) {
          const assistantMessage: Message = {
            id: data.data.messageId,
            conversationId,
            role: "assistant",
            content: data.data.content,
            sources: data.data.sources,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (error) {
        console.error("Failed to send message:", error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDelete = async () => {
    if (!conversationId) return;
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/chat/conversations/${conversationId}`, {
        method: "DELETE",
      });
      onBack?.();
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  if (!conversationId) {
    return <ChatEmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack} className="lg:hidden">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h2 className="font-semibold">{conversation?.title || "New Chat"}</h2>
            <p className="text-xs text-muted-foreground">
              {conversation?.context?.currentStock && (
                <Badge variant="secondary" className="text-[10px]">
                  {conversation.context.currentStock}
                </Badge>
              )}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="py-4">
          {messages.length === 0 ? (
            <ChatWelcome />
          ) : (
            <>
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {streamingContent && (
                <ChatMessage
                  message={{
                    id: "streaming",
                    conversationId: conversationId || "",
                    role: "assistant",
                    content: streamingContent,
                    createdAt: new Date().toISOString(),
                  }}
                  isStreaming={true}
                />
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border/50">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your research..."
              className="min-h-[44px] pr-12"
              disabled={isLoading}
            />
            <Button
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          AI responses are based on your research context and web sources
        </p>
      </div>
    </div>
  );
}

function ChatWelcome() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center mb-4">
        <Sparkles className="h-8 w-8 text-white" />
      </div>
      <h3 className="text-lg font-semibold mb-2">How can I help you?</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Ask follow-up questions about your research. I can explain findings, compare data, or dive deeper into specific areas.
      </p>
    </div>
  );
}

function ChatEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center mb-6">
        <Bot className="h-10 w-10 text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-2 gradient-text">Start a Conversation</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        Select an existing conversation from the sidebar or start a new one to chat about your research.
      </p>
    </div>
  );
}
