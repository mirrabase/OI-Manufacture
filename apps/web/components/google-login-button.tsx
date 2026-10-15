"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FirebaseError } from "firebase/app"
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword } from "firebase/auth"

import { Button } from "@workspace/ui/components/button"
import { manufacturerAuth, useFirebaseEmulator } from "@/lib/firebase/client"

export function GoogleLoginButton({ destination = "/-/overview" }: { destination?: string }) {
  const router = useRouter()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogleSignIn() {
    setError(null)
    setIsSigningIn(true)

    try {
      if (useFirebaseEmulator) await signInWithEmailAndPassword(manufacturerAuth, "manufacturer@oi.local", "local-manufacturer-123")
      else await signInWithPopup(manufacturerAuth, new GoogleAuthProvider())
      router.replace(destination)
      router.refresh()
    } catch (cause) {
      if (
        cause instanceof FirebaseError &&
        cause.code === "auth/popup-closed-by-user"
      ) {
        return
      }

      setError(
        cause instanceof FirebaseError && cause.code === "auth/unauthorized-domain"
          ? "This domain is not enabled for Google sign-in in Firebase."
          : useFirebaseEmulator ? "Local Manufacturer unavailable. Start pnpm dev or run pnpm seed:local with the emulators running." : "Could not sign in with Google. Please try again."
      )
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to continue to your account.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={isSigningIn}
        onClick={handleGoogleSignIn}
      >
        {!useFirebaseEmulator ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.99 7.28-2.65l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.15A11 11 0 0 0 1 12c0 1.78.43 3.46 1.15 4.95l3.69-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.36c1.62 0 3.06.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.85 6.05l3.69 2.84C6.71 7.29 9.14 5.36 12 5.36Z"
          />
        </svg> : null}
        {isSigningIn ? "Signing in..." : useFirebaseEmulator ? "Sign in as local Manufacturer" : "Continue with Google"}
      </Button>
      {error ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
