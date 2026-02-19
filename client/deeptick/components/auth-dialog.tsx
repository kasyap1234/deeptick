"use client";

import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "sign-up") {
        await signUp.email(
          { email, password, name: name || "New User" },
          {
            onSuccess: () => {
              setMode("sign-in");
              setError("Account created! Please sign in.");
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

  const handleOAuthSignIn = async (provider: "google" | "github") => {
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
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${open ? "block" : "hidden"}`}>
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <Card className="relative z-10 w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to DeepTick</CardTitle>
          <CardDescription>
            Sign in to access your research history
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "sign-in" | "sign-up")}>
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

                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Loading..." : mode === "sign-in" ? "Sign In" : "Create Account"}
                </Button>
              </div>
            </form>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => handleOAuthSignIn("google")}
                disabled={loading}
              >
                Google
              </Button>
              <Button
                variant="outline"
                onClick={() => handleOAuthSignIn("github")}
                disabled={loading}
              >
                GitHub
              </Button>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
