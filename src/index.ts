import { CommonModule } from '@angular/common'
import { NgModule, Injectable } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { NgbModal, NgbModalModule } from '@ng-bootstrap/ng-bootstrap'
import { ToolbarButtonProvider } from 'tabby-core'
import { ScpTransferDialogComponent } from './scp-dialog.component'

/**
 * Independent plugin entry point. Better Sidebar need not be installed.
 * Do not patch Better Sidebar's private views/DOM.
 */
@Injectable()
export class ScpToolbarButtonProvider {
    constructor(private modal: NgbModal) {}

    provide() {
        return [{
            icon: 'fa fa-exchange-alt',
            title: 'SCP file transfer',
            click: () => this.modal.open(ScpTransferDialogComponent, {
                size: 'lg',
                backdrop: 'static',
                keyboard: false,
                centered: true,
            }),
        }]
    }
}

@NgModule({
    imports: [CommonModule, FormsModule, NgbModalModule],
    declarations: [ScpTransferDialogComponent],
    providers: [
        { provide: ToolbarButtonProvider, useClass: ScpToolbarButtonProvider, multi: true },
    ],
})
export default class TabbyScpExtensionModule {}
