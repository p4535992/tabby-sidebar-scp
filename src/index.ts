import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { NgbModalModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule from 'tabby-core'
import { ScpBrowserComponent } from './scp-browser.component'
import { ScpTransferDialogComponent } from './scp-dialog.component'
import { ScpMountService } from './mount.service'

/** Independent Tabby plugin; Better Sidebar is optional and never imported. */
@NgModule({
    imports: [CommonModule, FormsModule, NgbModalModule, TabbyCoreModule],
    declarations: [ScpBrowserComponent, ScpTransferDialogComponent],
})
export default class TabbyScpModule {
    constructor(mount: ScpMountService) { void mount }
}
