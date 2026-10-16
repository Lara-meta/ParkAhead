"use client";
import { useState } from "react";
import { authClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
export function SignIn({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="panel mx-auto max-w-md"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await authClient().auth.signInWithPassword({
            email,
            password,
          });
          if (r.error) throw r.error;
          window.location.assign(returnTo);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Sign in failed.");
          setBusy(false);
        }
      }}
    >
      <h1 className="text-3xl font-semibold">Sign in to continue</h1>
      <p className="my-4 text-sm muted">
        You will return to the booking screen. Arrival still requires your
        explicit confirmation.
      </p>
      {error && (
        <p role="alert" className="notice mb-4 text-red-800">
          {error}
        </p>
      )}
      <label>
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label className="mt-4 block">
        Password
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <Button disabled={busy} className="mt-5">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
