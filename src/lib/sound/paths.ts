import { previewPathPrefix } from "@/lib/preview-path-prefix";

/** Keep fetches on the path-based preview prefix. Router links already do this. */
export function appPath(path: string): string {
  if (typeof window === "undefined") return path;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
  return prefix ? `${prefix}${path}` : path;
}
