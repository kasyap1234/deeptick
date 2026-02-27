"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { signIn, signUp, type AuthSocialProvider, authSocialProviderLabels, authSocialProviders } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissable?: boolean;
}

export function AuthDialog({ open, onOpenChange, dismissable = true }: AuthDialogProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "sign-up") {
        await signUp.email(
          { email, password, name: name || "New User" },
          {
            onSuccess: () => {
              setMode("sign-in");
              setSuccess("Account created! Please sign in.");
              setError("");
            },
            onError: (ctx) => {
              setError(ctx.error.message || "Sign up failed");
            },
          }
        );
      } else {
        await signIn.email(
          { email, password },
          {
            onSuccess: () => {
              onOpenChange(false);
            },
            onError: (ctx) => {
              setError(ctx.error.message || "Invalid credentials");
            },
          }
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: AuthSocialProvider) => {
    try {
      await signIn.social({
        provider,
        callbackURL: "/",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `Failed to sign in with ${provider}`;
      setError(message);
    }
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={dismissable ? onOpenChange : undefined}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={dismissable ? undefined : (e) => e.preventDefault()}
          onPointerDownOutside={dismissable ? undefined : (e) => e.preventDefault()}
          onInteractOutside={dismissable ? undefined : (e) => e.preventDefault()}
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] bg-card border border-border rounded-lg shadow-lg p-6 mx-4"
        >
          <div className="text-center mb-4">
            <DialogPrimitive.Title className="text-2xl font-semibold">Welcome to DeepTick</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground mt-1">
              Sign in to access your research history
            </DialogPrimitive.Description>
          </div>

          <Tabs value={mode} onValueChange={(v) => {
            setMode(v as "sign-in" | "sign-up");
            setEmail("");
            setPassword("");
            setName("");
            setError("");
            setSuccess("");
          }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sign-in">Sign In</TabsTrigger>
              <TabsTrigger value="sign-up">Sign Up</TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit}>
              <div className="space-y-4 mt-4">
                {mode === "sign-up" && (
                  <div className="space-y-2">
                    <Input
                      type="text"
                      placeholder="Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>

                {success && (
                  <p className="text-sm text-emerald-600">{success}</p>
                )}
                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Loading..." : mode === "sign-in" ? "Sign In" : "Create Account"}
                </Button>
              </div>
            </form>

            {authSocialProviders.length > 0 && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>

                <div className={`grid gap-2 ${authSocialProviders.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {authSocialProviders.map((provider) => (
                    <Button
                      key={provider}
                      variant="outline"
                      onClick={() => handleOAuthSignIn(provider)}
                      disabled={loading}
                    >
                      {authSocialProviderLabels[provider]}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
