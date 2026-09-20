/**
 * Export destination handling.
 *
 * Two kinds of destination:
 *
 * - `default` — a plain filesystem path Rust can write to directly. On Android
 *   the native bridge supplies the app's external files dir (no permission
 *   needed); elsewhere it is `api_export_default_dir` (a `JM` folder in the
 *   platform download directory).
 * - `custom` — a folder the user picked through the system picker. On Android
 *   that is a SAF tree URI which only the document API can write to, so the
 *   Rust side stages the export and the native bridge streams each file across.
 */

type ShellBridge = {
  defaultExportDir?: () => string;
  savedExportDir?: () => string | null;
  savedExportDirLabel?: () => string;
  pickExportDir?: () => void;
  clearExportDir?: () => boolean;
  exportDirWritable?: () => boolean;
  copyToTree?: (relativePath: string, sourcePath: string) => string;
};

export type ExportDirMode = "default" | "custom";

const KEY_MODE = "jm_export_dir_mode";
const PICKED_EVENT = "jm:export-dir-picked";

export function shellBridge(): ShellBridge | null {
  const bridge = (window as unknown as { JMShell?: ShellBridge }).JMShell;
  return bridge ?? null;
}

/** True on Android, where a folder picker is available. */
export function pickSupported(): boolean {
  return typeof shellBridge()?.pickExportDir === "function";
}

export function getExportDirMode(): ExportDirMode {
  try {
    return localStorage.getItem(KEY_MODE) === "custom" ? "custom" : "default";
  } catch {
    return "default";
  }
}

export function setExportDirMode(mode: ExportDirMode) {
  try {
    localStorage.setItem(KEY_MODE, mode);
  } catch {
    // ignore
  }
}

/** Path of the always-writable default destination. */
export async function resolveDefaultDir(): Promise<string> {
  const fromBridge = shellBridge()?.defaultExportDir?.();
  if (fromBridge) return fromBridge;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("api_export_default_dir");
}

export type CustomDirInfo = { label: string; writable: boolean };

export function savedCustomDir(): CustomDirInfo | null {
  const bridge = shellBridge();
  if (!bridge?.savedExportDir) return null;
  const uri = bridge.savedExportDir();
  if (!uri) return null;
  return {
    label: bridge.savedExportDirLabel?.() || uri,
    writable: bridge.exportDirWritable?.() ?? true,
  };
}

export function clearCustomDir() {
  shellBridge()?.clearExportDir?.();
}

/**
 * Opens the system folder picker. Resolves with the folder name, or null when
 * the user cancelled.
 */
export function pickCustomDir(): Promise<string | null> {
  const bridge = shellBridge();
  if (!bridge?.pickExportDir) return Promise.resolve(null);
  return new Promise((resolve) => {
    const target = window as unknown as { __jmShellOnDirPicked?: (uri: string | null) => void };
    let settled = false;
    const finish = (uri: string | null) => {
      if (settled) return;
      settled = true;
      delete target.__jmShellOnDirPicked;
      window.dispatchEvent(new Event(PICKED_EVENT));
      resolve(uri ? savedCustomDir()?.label ?? uri : null);
    };
    target.__jmShellOnDirPicked = finish;
    bridge.pickExportDir?.();
    // The picker can be dismissed without a callback on some OEM builds.
    window.setTimeout(() => finish(null), 5 * 60 * 1000);
  });
}

export function subscribeExportDirChange(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(PICKED_EVENT, handler);
  return () => window.removeEventListener(PICKED_EVENT, handler);
}

/** Streams one staged file into the picked folder. Empty string means success. */
export function copyIntoTree(relativePath: string, sourcePath: string): string {
  const bridge = shellBridge();
  if (!bridge?.copyToTree) return "当前平台不支持自定义目录";
  return bridge.copyToTree(relativePath, sourcePath) || "";
}
