import { ConfigProvider } from 'tabby-core'

/** Values persisted in Tabby's config file under the `scpSidebar` key. */
export interface ScpSidebarConfig {
    /** Show the SCP file browser; toggled at runtime from Tabby's Settings tab. */
    enabled: boolean
}

export const DEFAULT_SCP_SIDEBAR_CONFIG: ScpSidebarConfig = {
    enabled: true,
}

/**
 * Registers the plugin defaults, so `config.store.scpSidebar` always exists and
 * the settings checkbox can bind to it directly.
 */
export class ScpSidebarConfigProvider extends ConfigProvider {
    defaults = {
        scpSidebar: DEFAULT_SCP_SIDEBAR_CONFIG,
    }
}
