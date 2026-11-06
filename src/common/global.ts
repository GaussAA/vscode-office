import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';

const prefix = 'vscode-office';

export function language() {
    return vscode.env.language;
}

/**
 * Extension-host message lookup. Backed by `vscode.l10n`, which reads
 * `l10n/bundle.l10n.<locale>.json` (see `"l10n"` in package.json) and falls back to the key
 * itself. It replaced a hand-rolled loader that read `package.nls.*.json` at runtime — files
 * that share a name with VS Code's manifest-localization convention but were never used for
 * it, since no `%key%` appears in package.json.
 *
 * The webview has its own i18n (`src/react/i18n`): `vscode.l10n` only covers the host.
 */
export function i18n(key: string, ...args: string[]) {
    return vscode.l10n.t(key, ...args);
}

export class Global {
    public static context: ExtensionContext;

    public static async init(context: ExtensionContext) {
        Global.context = context;
    }

    /**
     * get configuration from vscode setting.
     * @param key config key
     */
    public static getConfig<T>(key: string, defaultValue?: T): T {
        const config = vscode.workspace.getConfiguration(prefix);
        // The VS Code API has no overload that accepts an explicit `undefined` default, so
        // the optional parameter is narrowed away here instead of at every call site.
        return defaultValue === undefined ? config.get<T>(key) as T : config.get<T>(key, defaultValue);
    }

    /**
     * update config for vscode, config must def in package.json.
     * @param name  config name
     * @param value config value
     */
    public static async updateConfig(name: string, value: any) {
        const config = vscode.workspace.getConfiguration(prefix);
        const meta = config.inspect(name);
        const newValue = meta?.defaultValue == value ? undefined : value;
        await config.update(name, newValue, true);
    }
}
