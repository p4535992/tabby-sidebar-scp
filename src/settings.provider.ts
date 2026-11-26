import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { ScpSidebarSettingsComponent } from './settings.component'

/** Adds the plugin entry to Tabby's Settings tab. */
@Injectable()
export class ScpSidebarSettingsTabProvider extends SettingsTabProvider {
    id = 'scp-sidebar'
    icon = 'exchange-alt'
    title = 'SCP Sidebar'
    weight = 10

    getComponentType(): any {
        return ScpSidebarSettingsComponent
    }
}
