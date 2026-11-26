import { Component, HostBinding } from '@angular/core'
import { ConfigService } from 'tabby-core'

/**
 * Entry in Tabby's Settings tab. The checkbox writes `scpSidebar.enabled` and
 * saves the config; `ScpMountService` listens to `config.changed$`, so the
 * panel appears or disappears without restarting Tabby.
 */
@Component({
    selector: 'scp-sidebar-settings',
    template: `
        <h3 class="mb-3">SCP Sidebar</h3>

        <div class="form-line">
            <div class="header">
                <div class="title">Enable the SCP file browser</div>
                <div class="description">
                    Shows the SCP tab and binds it to the active SSH session.
                    Disable it to hide the panel without uninstalling the plugin.
                </div>
            </div>
            <toggle [(ngModel)]="config.store.scpSidebar.enabled" (ngModelChange)="config.save()"></toggle>
        </div>

        <div class="alert alert-info d-flex align-items-center" *ngIf="!config.store.scpSidebar.enabled">
            <div class="me-auto">The SCP panel is hidden. Re-enable this option to show it again.</div>
        </div>

        <div class="form-line">
            <div class="header">
                <div class="title">Transport</div>
                <div class="description">
                    SCP over the SSH connection Tabby has already authenticated; the local
                    OpenSSH client is used only when no SSH session is open.
                </div>
            </div>
        </div>
    `,
})
export class ScpSidebarSettingsComponent {
    @HostBinding('class.content-box') contentBox = true

    constructor(public config: ConfigService) {}
}
