"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/push";

/** Registers the service worker at start so the Home Screen app opens without a connection. */
export function RegisterServiceWorker() {
  useEffect(() => {
    // dev builds change on every save; caching them would show stale pages
    if (process.env.NODE_ENV === "production") registerServiceWorker();
  }, []);
  return null;
}
