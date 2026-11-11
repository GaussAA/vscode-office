/**
 * The payload the extension inlines into `index.html` as `{{configs}}`.
 *
 * Typed explicitly: `let configs = null` used to narrow to the `null` type under
 * `strictNullChecks`, which made every `getConfigs()?.foo` a property access on `never`.
 */
export interface WebviewConfigs {
  route?: string;
  language?: string;
  fileName?: string;
  iconBaseUrl?: string;
  maps?: Record<string, string>;
  gitHistoryInit?: unknown;
  gitHistorySettings?: { quickSyncButton: boolean };
  config?: Record<string, unknown>;
}

let configs: WebviewConfigs | null = null;

export function getConfigs(): WebviewConfigs | null {
  if (configs) return configs;
  const elem = document.getElementById("office-configs");
  const value = elem?.getAttribute("data-config");
  if (!value || value === "{{configs}}") return null;
  configs = JSON.parse(value) as WebviewConfigs;
  return configs;
}
