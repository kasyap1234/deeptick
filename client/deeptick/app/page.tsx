"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  RefreshCw,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sidebar } from "@/components/sidebar";
import { ResearchCard } from "@/components/research-card";
import { ResearchReportView } from "@/components/research-report";
import { ResearchProgressView } from "@/components/research-progress-view";
import { ResearchErrorView } from "@/components/research-error-view";
import { NewResearchDialog } from "@/components/new-research-dialog";
import { EmptyState } from "@/components/empty-state";
import { AuthDialog } from "@/components/auth-dialog";
import { api, isGradientEnabled } from "@/lib/api";
import { useSession, signOut } from "@/lib/auth-client";
import type { ProgressUpdate, ResearchJob, WebSocketMessage } from "@/lib/types";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1200;

function isActiveResearchStatus(status?: ResearchJob["status"]) {
  return status === "pending" || status === "in_progress";
}

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
  const [progressByJob, setProgressByJob] = useState<Record<string, ProgressUpdate>>({});
  const socketsRef = useRef<Map<string, WebSocket>>(new Map());
  const reconnectTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const manualCloseRef = useRef<Set<string>>(new Set());
  const jobStatusRef = useRef<Map<string, ResearchJob["status"]>>(new Map());

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
      const fullJobs = response.data.map((job) => ({
        id: job.jobId,
        query: job.query,
        status: job.status as ResearchJob["status"],
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        result: undefined,
      } as ResearchJob));
      setJobs(fullJobs);
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeResearchSocket = useCallback((jobId: string) => {
    const socket = socketsRef.current.get(jobId);
    if (socket) {
      manualCloseRef.current.add(jobId);
      socket.close();
      socketsRef.current.delete(jobId);
    }

    const reconnectTimeout = reconnectTimeoutsRef.current.get(jobId);
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeoutsRef.current.delete(jobId);
    }
    reconnectAttemptsRef.current.delete(jobId);
  }, []);

  const handleSocketMessage = useCallback((jobId: string, message: WebSocketMessage) => {
    if (message.type === "status" || message.type === "progress") {
      const payload = (message.payload ?? {}) as ProgressUpdate;
      if (payload.status && !isActiveResearchStatus(payload.status)) {
        closeResearchSocket(jobId);
      }

      if (message.type === "progress") {
        setProgressByJob((prev) => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            ...payload,
            urls: payload.urls ?? prev[jobId]?.urls,
            reasoning: payload.reasoning ?? prev[jobId]?.reasoning,
            subAgentActivities: payload.subAgentActivities ?? prev[jobId]?.subAgentActivities,
          },
        }));
      }

      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
              ...job,
              status: payload.status ?? job.status,
              metadata: payload.uniqueSources !== undefined
                ? {
                  ...job.metadata,
                  sourceMetrics: {
                    uniqueSources: payload.uniqueSources,
                    domainCount: payload.domainCount ?? job.metadata?.sourceMetrics?.domainCount ?? 0,
                    recentSourceCount: job.metadata?.sourceMetrics?.recentSourceCount ?? 0,
                  },
                }
                : job.metadata,
            }
            : job,
        ),
      );

      setSelectedJob((prev) =>
        prev && prev.id === jobId
          ? {
            ...prev,
            status: payload.status ?? prev.status,
            metadata: payload.uniqueSources !== undefined
              ? {
                ...prev.metadata,
                sourceMetrics: {
                  uniqueSources: payload.uniqueSources,
                  domainCount: payload.domainCount ?? prev.metadata?.sourceMetrics?.domainCount ?? 0,
                  recentSourceCount: prev.metadata?.sourceMetrics?.recentSourceCount ?? 0,
                },
              }
              : prev.metadata,
          }
          : prev,
      );
    }

    if (message.type === "result") {
      fetchJobs();
      closeResearchSocket(jobId);
      if (selectedJob?.id === jobId) {
        api.getResearchJob(jobId)
          .then((response) => setSelectedJob(response.data))
          .catch((error) => console.error("Failed to fetch completed job:", error));
      }
    }

    if (message.type === "error") {
      const errorPayload = (message.payload as { error?: string; code?: string } | undefined) ?? {};
      const errorMessage = errorPayload.error ?? "Research failed with an unknown error.";
      const composedError = errorPayload.code ? `${errorMessage} [${errorPayload.code}]` : errorMessage;
      console.error("Research error:", errorMessage);

      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
              ...job,
              status: "failed",
              error: composedError,
            }
            : job,
        ),
      );

      setSelectedJob((prev) =>
        prev && prev.id === jobId
          ? {
            ...prev,
            status: "failed",
            error: composedError,
          }
          : prev,
      );

      setProgressByJob((prev) => ({
        ...prev,
        [jobId]: {
          ...prev[jobId],
          stage: "failed",
          status: "failed",
          reasoning: [...(prev[jobId]?.reasoning ?? []), `Error: ${composedError}`].slice(-20),
        },
      }));

      closeResearchSocket(jobId);
    }
  }, [closeResearchSocket, fetchJobs, selectedJob?.id]);

  const connectResearchSocket = useCallback((jobId: string) => {
    const existing = socketsRef.current.get(jobId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return;
    }

    closeResearchSocket(jobId);
    const ws = api.connectResearchWebSocket(jobId);
    socketsRef.current.set(jobId, ws);

    const queueReconnect = () => {
      const status = jobStatusRef.current.get(jobId);
      if (!isActiveResearchStatus(status)) {
        reconnectAttemptsRef.current.delete(jobId);
        return;
      }

      const attempt = (reconnectAttemptsRef.current.get(jobId) ?? 0) + 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current.delete(jobId);
        setProgressByJob((prev) => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            reasoning: [...(prev[jobId]?.reasoning ?? []), "Realtime updates disconnected after max reconnect attempts."].slice(-20),
          },
        }));
        return;
      }

      reconnectAttemptsRef.current.set(jobId, attempt);
      const jitter = Math.floor(Math.random() * 300);
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** (attempt - 1)), 10000) + jitter;
      const timeoutId = setTimeout(() => {
        reconnectTimeoutsRef.current.delete(jobId);
        const latestStatus = jobStatusRef.current.get(jobId);
        if (isActiveResearchStatus(latestStatus)) {
          connectResearchSocket(jobId);
        }
      }, delay);
      reconnectTimeoutsRef.current.set(jobId, timeoutId);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage;
        handleSocketMessage(jobId, data);
      } catch (error) {
        console.error("Invalid websocket payload:", error);
      }
    };

    ws.onopen = () => {
      reconnectAttemptsRef.current.delete(jobId);
      manualCloseRef.current.delete(jobId);
    };

    ws.onclose = () => {
      socketsRef.current.delete(jobId);
      const wasManualClose = manualCloseRef.current.has(jobId);
      if (wasManualClose) {
        manualCloseRef.current.delete(jobId);
        return;
      }
      queueReconnect();
    };

    ws.onerror = () => {
      // Browser emits onclose after onerror; reconnect is handled in onclose.
    };
  }, [closeResearchSocket, handleSocketMessage]);

  const handleSelectJob = async (job: ResearchJob) => {
    const shouldFetchDetails =
      (job.status === 'completed' && !job.result) ||
      (job.status === 'failed' && !job.error);

    if (shouldFetchDetails) {
      try {
        const response = await api.getResearchJob(job.id);
        setSelectedJob(response.data);
      } catch (error) {
        console.error("Failed to fetch job details:", error);
        setSelectedJob(job);
      }
    } else {
      setSelectedJob(job);
    }

    if (job.status === "in_progress" || job.status === "pending") {
      connectResearchSocket(job.id);
    }
  };

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

  useEffect(() => {
    const statusMap = new Map<string, ResearchJob["status"]>();
    jobs.forEach((job) => statusMap.set(job.id, job.status));
    if (selectedJob) {
      statusMap.set(selectedJob.id, selectedJob.status);
    }
    jobStatusRef.current = statusMap;
  }, [jobs, selectedJob]);

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status === "in_progress" || selectedJob.status === "pending") {
      connectResearchSocket(selectedJob.id);
    }
  }, [selectedJob, connectResearchSocket]);

  useEffect(() => {
    const currentSockets = socketsRef.current;
    return () => {
      Array.from(currentSockets.keys()).forEach((jobId) => closeResearchSocket(jobId));
    };
  }, [closeResearchSocket]);

  const handleCreateResearch = async (
    query: string,
    context?: string,
    focusAreas?: string[]
  ) => {
    try {
      setIsCreating(true);
      const response = await api.createResearchJob(query, context, focusAreas);
      const jobId = response.data.jobId;

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
      setSelectedJob(newJob);
      setShowNewDialog(false);
      connectResearchSocket(jobId);
    } catch (error) {
      console.error("Failed to create research:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    const matchesSearch = job.query
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter ? job.status === statusFilter : true;
    return matchesSearch && matchesStatus;
  }), [jobs, searchQuery, statusFilter]);

  const statusCounts = useMemo(() => ({
    pending: jobs.filter((j) => j.status === "pending").length,
    in_progress: jobs.filter((j) => j.status === "in_progress").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  }), [jobs]);

  const isGradient = isGradientEnabled;

  return (
    <div className="flex h-screen overflow-hidden bg-background bg-grid-pattern noise text-foreground font-sans">
      <Sidebar
        className="w-64 shrink-0 hidden md:flex border-r border-border backdrop-blur-md bg-background/90"
        activeTab="research"
        onNewResearch={() => setShowNewDialog(true)}
      />

      <main className="flex-1 flex overflow-hidden border-l-4 border-double border-foreground/30 shadow-[-10px_0_30px_-10px_rgba(0,0,0,0.1)] relative z-10">
        <div
          className={cn(
            "flex flex-col border-r-4 border-double border-border transition-all duration-300 relative bg-background/95 backdrop-blur-sm",
            selectedJob ? "w-[450px] hidden lg:flex" : "flex-1"
          )}
        >
          <div className="absolute top-0 right-0 p-1 font-mono text-[8px] text-muted-foreground rotate-90 origin-top-right translate-y-2 opacity-50">
            SEC_ID: X7K9M2PQ
          </div>
          <div className="flex h-20 items-center justify-between px-8 border-b-2 border-border">
            <div className="flex flex-col gap-1">
              <div>
                <h1 className="text-3xl font-serif text-foreground tracking-tight">DATABASE QUERIES</h1>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                  {jobs.length} DOSSIER{jobs.length !== 1 ? "S" : ""} FOUND
                </p>
              </div>
              {isGradient && (
                <div className="mt-2 flex items-center gap-1.5 px-2 py-1 bg-cyan-500/10 border-l-2 border-cyan-500 w-fit">
                  <div className="h-1.5 w-1.5 bg-cyan-500" />
                  <span className="font-mono text-[9px] uppercase tracking-widest text-cyan-700 dark:text-cyan-400 font-bold">
                    GRADIENT ACTIVE
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isAuthenticated && session?.user && (
                <div className="flex items-center gap-2 mr-2">
                  <Avatar className="h-8 w-8 rounded-none border border-border">
                    <AvatarFallback className="text-xs font-mono rounded-none">{userInitials}</AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] font-mono uppercase tracking-widest hidden lg:block">{session.user.name || session.user.email}</span>
                </div>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={fetchJobs}
                disabled={isLoading}
                className="rounded-none"
              >
                <RefreshCw
                  className={cn("h-4 w-4", isLoading && "animate-spin")}
                />
              </Button>
              {isAuthenticated ? (
                <Button variant="outline" size="icon" onClick={handleSignOut} className="rounded-none">
                  <LogOut className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="outline" size="icon" onClick={() => setShowAuthDialog(true)} className="rounded-none">
                  <User className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col border-b-2 border-border bg-muted/20">
            <div className="relative border-b border-border/50">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="SEARCH DOSSIERS [ ENTER PARAMETERS ]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-14 h-16 rounded-none font-mono text-sm uppercase tracking-widest border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent text-foreground placeholder:text-muted-foreground/70"
              />
            </div>

            <div className="flex items-center w-full overflow-x-auto relative">
              <div className="absolute bottom-0 left-0 w-full h-[2px] bg-border" />
              <Button
                variant={statusFilter === null ? "default" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter(null)}
                className={cn(
                  "rounded-none font-mono text-[10px] uppercase tracking-widest shrink-0 h-10 border-r border-border relative z-10",
                  statusFilter === null ? "bg-foreground text-background font-bold border-r-transparent hover:bg-foreground hover:text-background" : "hover:bg-muted/50 text-muted-foreground bg-transparent"
                )}
              >
                ALL ({jobs.length})
              </Button>
              {statusCounts.in_progress > 0 && (
                <Button
                  variant={statusFilter === "in_progress" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setStatusFilter("in_progress")}
                  className={cn(
                    "rounded-none font-mono text-[10px] uppercase tracking-widest shrink-0 h-10 border-r border-border relative z-10",
                    statusFilter === "in_progress" ? "bg-cyan-600 dark:bg-cyan-900 text-white font-bold border-r-transparent hover:bg-cyan-600" : "text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/10 bg-transparent"
                  )}
                >
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  ACTIVE ({statusCounts.in_progress})
                </Button>
              )}
              <Button
                variant={statusFilter === "completed" ? "default" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("completed")}
                className={cn(
                  "rounded-none font-mono text-[10px] uppercase tracking-widest shrink-0 h-10 border-r border-border relative z-10",
                  statusFilter === "completed" ? "bg-emerald-600 dark:bg-emerald-900 text-white font-bold border-r-transparent hover:bg-emerald-600" : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 bg-transparent"
                )}
              >
                COMPLETED ({statusCounts.completed})
              </Button>
              <Button
                variant={statusFilter === "failed" ? "default" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter("failed")}
                className={cn(
                  "rounded-none font-mono text-[10px] uppercase tracking-widest shrink-0 h-10 border-r border-border relative z-10",
                  statusFilter === "failed" ? "bg-red-600 dark:bg-red-900 text-white font-bold border-r-transparent hover:bg-red-600" : "text-red-700 dark:text-red-400 hover:bg-red-500/10 bg-transparent"
                )}
              >
                FAILED ({statusCounts.failed})
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {isLoading && jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-[10px] uppercase tracking-widest animate-pulse">
                  <div className="w-16 h-16 border-4 border-border border-t-foreground rounded-full animate-spin mb-4" />
                  <p>ACCESSING MAINFRAME...</p>
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-muted-foreground border-2 border-dashed border-border bg-muted/10 mx-2 mt-2 pt-16">
                  <span className="font-mono text-5xl mb-4 opacity-30 select-none block">■</span>
                  <p className="text-center font-mono text-[10px] uppercase tracking-widest font-bold">
                    {searchQuery || statusFilter
                      ? "[ NULL RESULT SET ]"
                      : "AWAITING DIRECTIVES."}
                  </p>
                  {!searchQuery && !statusFilter && (
                    <Button
                      variant="outline"
                      className="mt-8 gap-2 rounded-none border-2 border-primary bg-background text-primary hover:bg-primary hover:text-primary-foreground font-mono text-[10px] uppercase tracking-widest px-8 py-6 shadow-none transition-colors"
                      onClick={() => setShowNewDialog(true)}
                    >
                      INITIALIZE SEQUENCE
                    </Button>
                  )}
                </div>
              ) : (
                filteredJobs.map((job, index) => (
                  <motion.div
                    key={job.id || `job-${index}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <ResearchCard
                      job={job}
                      isSelected={selectedJob?.id === job.id}
                      onClick={() => handleSelectJob(job)}
                    />
                  </motion.div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 overflow-hidden relative bg-dot-pattern">
          <div className="absolute top-0 bottom-0 left-0 w-8 border-r-2 border-border/50 flex flex-col items-center py-4 bg-background/50 backdrop-blur-sm z-0">
            <span className="font-mono text-[8px] text-muted-foreground rotate-90 whitespace-nowrap opacity-50 mt-16 font-bold tracking-[0.2em]">
              TERMINAL SEC: ALPHA-9 // ALIGNMENT: STRICT
            </span>
          </div>

          <div className="absolute top-0 right-0 p-3 z-0 pointer-events-none opacity-[0.03]">
            <span className="font-serif text-[120px] leading-none select-none">
              D
            </span>
          </div>

          <div className="flex-1 h-full overflow-auto z-10 relative">
            <AnimatePresence mode="wait">
              {selectedJob ? (
                (selectedJob.status === "in_progress" || selectedJob.status === "pending") ? (
                  <ResearchProgressView
                    key="progress"
                    job={selectedJob}
                    progress={progressByJob[selectedJob.id]}
                    onBack={() => setSelectedJob(null)}
                  />
                ) : selectedJob.status === "failed" ? (
                  <ResearchErrorView
                    key="failed"
                    job={selectedJob}
                    onBack={() => setSelectedJob(null)}
                  />
                ) : (
                  <ResearchReportView
                    key="report"
                    job={selectedJob}
                    onBack={() => setSelectedJob(null)}
                  />
                )
              ) : (
                <EmptyState
                  key="empty"
                  onStartResearch={() => setShowNewDialog(true)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <NewResearchDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        onSubmit={handleCreateResearch}
        isLoading={isCreating}
      />

      <AuthDialog open={showAuthDialog} onOpenChange={setShowAuthDialog} dismissable={isAuthenticated} />
    </div>
  );
}
