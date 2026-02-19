"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  RefreshCw,
  Sparkles,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sidebar } from "@/components/sidebar";
import { ResearchCard } from "@/components/research-card";
import { ResearchReportView } from "@/components/research-report";
import { NewResearchDialog } from "@/components/new-research-dialog";
import { EmptyState } from "@/components/empty-state";
import { AuthDialog } from "@/components/auth-dialog";
import { api, useGradient } from "@/lib/api";
import { useSession, signOut } from "@/lib/auth-client";
import type { ResearchJob } from "@/lib/types";

export default function Home() {
  const { data: session, isPending: sessionLoading } = useSession();
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<ResearchJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  const isAuthenticated = !!session?.user;
  const userInitials = session?.user?.name
    ? session.user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : session?.user?.email?.[0]?.toUpperCase() || "U";

  const handleSignOut = async () => {
    await signOut();
    setJobs([]);
    setShowAuthDialog(true);
  };

  const fetchJobs = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.getResearchJobs();
      const fullJobs = await Promise.all(
        response.data.map(async (job) => {
          try {
            const detail = await api.getResearchJob(job.jobId);
            return detail.data;
          } catch {
            return {
              id: job.jobId,
              query: job.query,
              status: job.status as ResearchJob["status"],
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              result: job.hasResult ? undefined : undefined,
            } as ResearchJob;
          }
        })
      );
      setJobs(fullJobs);
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && !session) {
      setShowAuthDialog(true);
    }
  }, [sessionLoading, session]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchJobs();
    }
  }, [isAuthenticated, fetchJobs]);

  const handleCreateResearch = async (
    query: string,
    context?: string,
    focusAreas?: string[]
  ) => {
    try {
      setIsCreating(true);
      const response = await api.createResearchJob(query, context, focusAreas);
      const jobId = response.data.jobId;

      const connectWebSocket = () => {
        const ws = api.connectResearchWebSocket(jobId);

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === "status" || data.type === "progress") {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId
                  ? {
                      ...j,
                      status: data.payload?.status || j.status,
                      metadata: data.payload?.uniqueSources
                        ? {
                            ...j.metadata,
                            sourceMetrics: {
                              uniqueSources: data.payload.uniqueSources,
                              domainCount: data.payload.domainCount,
                              recentSourceCount: 0,
                            },
                          }
                        : j.metadata,
                    }
                  : j
              )
            );
          }

          if (data.type === "result") {
            fetchJobs();
            ws.close();
          }

          if (data.type === "error") {
            console.error("Research error:", data.payload?.error);
            ws.close();
          }
        };

        ws.onerror = () => {
          setTimeout(connectWebSocket, 3000);
        };
      };

      const newJob: ResearchJob = {
        id: jobId,
        query,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result: undefined,
        error: undefined,
        metadata: undefined,
      };

      setJobs((prev) => [newJob, ...prev]);
      setShowNewDialog(false);
      connectWebSocket();
    } catch (error) {
      console.error("Failed to create research:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    const matchesSearch = job.query
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter ? job.status === statusFilter : true;
    return matchesSearch && matchesStatus;
  });

  const statusCounts = {
    pending: jobs.filter((j) => j.status === "pending").length,
    in_progress: jobs.filter((j) => j.status === "in_progress").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  const isGradient = useGradient;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        className="w-64 shrink-0 hidden md:flex"
        activeTab="research"
        onNewResearch={() => setShowNewDialog(true)}
      />

      <main className="flex-1 flex overflow-hidden">
        <div
          className={cn(
            "flex flex-col border-r border-border/50 transition-all duration-300",
            selectedJob ? "w-96 hidden lg:flex" : "flex-1"
          )}
        >
          <div className="flex h-16 items-center justify-between px-6 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-lg font-semibold">Research History</h1>
                <p className="text-xs text-muted-foreground">
                  {jobs.length} research{jobs.length !== 1 ? "es" : ""}
                </p>
              </div>
              {isGradient && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
                  <span className="text-[10px] font-medium text-cyan-600 dark:text-cyan-400">
                    Gradient
                  </span>
                </motion.div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isAuthenticated && session?.user && (
                <div className="flex items-center gap-2 mr-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm hidden lg:block">{session.user.name || session.user.email}</span>
                </div>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={fetchJobs}
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn("h-4 w-4", isLoading && "animate-spin")}
                />
              </Button>
              {isAuthenticated ? (
                <Button variant="outline" size="icon" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="outline" size="icon" onClick={() => setShowAuthDialog(true)}>
                  <User className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search research..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <Button
                variant={statusFilter === null ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter(null)}
                className="text-xs shrink-0"
              >
                All ({jobs.length})
              </Button>
              {statusCounts.in_progress > 0 && (
                <Button
                  variant={statusFilter === "in_progress" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setStatusFilter("in_progress")}
                  className="text-xs shrink-0"
                >
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Active ({statusCounts.in_progress})
                </Button>
              )}
              <Button
                variant={statusFilter === "completed" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("completed")}
                className="text-xs shrink-0"
              >
                Completed ({statusCounts.completed})
              </Button>
              <Button
                variant={statusFilter === "failed" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("failed")}
                className="text-xs shrink-0"
              >
                Failed ({statusCounts.failed})
              </Button>
            </div>
          </div>

          <Separator />

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {isLoading && jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mb-4" />
                  <p>Loading research history...</p>
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Sparkles className="h-12 w-12 mb-4 opacity-50" />
                  <p className="text-center">
                    {searchQuery || statusFilter
                      ? "No matching research found"
                      : "No research yet. Start your first query!"}
                  </p>
                  {!searchQuery && !statusFilter && (
                    <Button
                      className="mt-4 gap-2"
                      onClick={() => setShowNewDialog(true)}
                    >
                      <Sparkles className="h-4 w-4" />
                      New Research
                    </Button>
                  )}
                </div>
              ) : (
                filteredJobs.map((job, index) => (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <ResearchCard
                      job={job}
                      isSelected={selectedJob?.id === job.id}
                      onClick={() => setSelectedJob(job)}
                    />
                  </motion.div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {selectedJob ? (
              <ResearchReportView
                key="report"
                job={selectedJob}
                onBack={() => setSelectedJob(null)}
              />
            ) : (
              <EmptyState
                key="empty"
                onStartResearch={() => setShowNewDialog(true)}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      <NewResearchDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSubmit={handleCreateResearch}
        isLoading={isCreating}
      />

      <AuthDialog open={showAuthDialog} onOpenChange={setShowAuthDialog} />
    </div>
  );
}
