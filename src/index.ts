import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { NgbModalModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ConfigProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { ScpSidebarConfigProvider } from './config'
import { ScpBrowserComponent } from './scp-browser.component'
import { ScpTransferDialogComponent } from './scp-dialog.component'
import { ScpMountService } from './mount.service'
import { ScpSidebarSettingsComponent } from './settings.component'
import { ScpSidebarSettingsTabProvider } from './settings.provider'

/** Independent Tabby plugin; Better Sidebar is optional and never imported. */
@NgModule({
    imports: [CommonModule, FormsModule, NgbModalModule, TabbyCoreModule],
    declarations: [ScpBrowserComponent, ScpTransferDialogComponent, ScpSidebarSettingsComponent],
    providers: [
        { provide: ConfigProvider, useClass: ScpSidebarConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ScpSidebarSettingsTabProvider, multi: true },
    ],
})
export default class TabbyScpModule {
    constructor(mount: ScpMountService) { void mount }
}

