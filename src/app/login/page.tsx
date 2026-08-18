"use client";

import { createClient } from "@/lib/supabase-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const supabase = createClient();

    const { error: authError } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <div className="bg-elevated border border-border-default rounded-lg p-8 w-full max-w-sm shadow-sm">
        <h1 className="text-2xl font-semibold text-text-primary mb-6">
          Life OS
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-border-default rounded-sm px-3 py-2 bg-card text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-border-default rounded-sm px-3 py-2 bg-card text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
            required
          />
          {error && (
            <p className="text-accent-danger text-sm">{error}</p>
          )}
          <button
            type="submit"
            className="bg-accent-primary text-white rounded-sm px-4 py-2 font-medium hover:opacity-90 transition-opacity"
          >
            {isSignUp ? "Sign Up" : "Sign In"}
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-text-secondary text-sm hover:text-text-primary"
          >
            {isSignUp
              ? "Already have an account? Sign in"
              : "First time? Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
