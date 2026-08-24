"use client";

import { useEffect } from "react";
import api from "@/lib/api";
import {
  registerCrmWebMcpTools,
  type WebMcpApiClient,
  type WebMcpModelContext,
} from "@/lib/webmcp";
import { useAuth } from "@/providers/AuthProvider";

interface WebMcpDocument extends Document {
  modelContext?: WebMcpModelContext;
}

interface WebMcpNavigator extends Navigator {
  modelContext?: WebMcpModelContext;
}

const authenticatedApi: WebMcpApiClient = {
  get: (url, config) =>
    api.get(url, config).then((response) => ({ data: response.data })),
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function WebMcpProvider() {
  const { agent, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading || !agent) return undefined;

    const modelContext =
      (document as WebMcpDocument).modelContext ??
      (navigator as WebMcpNavigator).modelContext;
    if (!modelContext) return undefined;

    const controller = new AbortController();
    // WebMCP uses the registration signal as the official unregister mechanism.
    void registerCrmWebMcpTools(modelContext, authenticatedApi, {
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (!isAbortError(error)) {
        console.error("[WebMCP] Failed to register CRM tools", error);
      }
    });

    return () => controller.abort();
  }, [agent?.id, isLoading]);

  return null;
}
