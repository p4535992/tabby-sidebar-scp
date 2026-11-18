import { Component, NgZone, OnDestroy } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { ScpDirection, ScpTask, ScpTransferOptions, startScpTransfer } from './scp-core'

/** Transfer UI is deliberately not coupled to Better Sidebar's private tree. */
@Component({
    selector: 'tabby-scp-transfer-dialog',
    template: `
        <div class="modal-header">
            <h4 class="modal-title">SCP transfer</h4>
            <button type="button" class="btn-close" aria-label="Close" [disabled]="isBusy" (click)="close()"></button>
        </div>
        <form (ngSubmit)="start()" autocomplete="off">
            <div class="modal-body scp-dialog">
                <p class="text-muted small">
                    Independent SCP transfer using your local OpenSSH client (<code>scp -O</code>).
                    Existing SSH passwords and sessions in Tabby are not reused.
                </p>
                <div class="scp-columns">
                    <label>Direction
                        <select class="form-control form-select" name="direction" [(ngModel)]="direction" [disabled]="isBusy">
                            <option value="upload">Upload (local → remote)</option>
                            <option value="download">Download (remote → local)</option>
                        </select>
                    </label>
                    <label>Host / SSH config alias
                        <input class="form-control" name="host" [(ngModel)]="host" required
                               [disabled]="isBusy" placeholder="my-server" />
                    </label>
                    <label>Username (optional)
                        <input class="form-control" name="username" [(ngModel)]="username"
                               [disabled]="isBusy" placeholder="from SSH config" />
                    </label>
                    <label>SSH port (optional)
                        <input class="form-control" name="port" [(ngModel)]="port"
                               [disabled]="isBusy" inputmode="numeric" placeholder="from SSH config / 22" />
                    </label>
                </div>
                <label>Local path (absolute, or <code>~/...</code>)
                    <input class="form-control" name="localPath" [(ngModel)]="localPath" required
                           [disabled]="isBusy" placeholder="/home/me/file.tar.gz" />
                </label>
                <label>Remote path (absolute, POSIX)
                    <input class="form-control" name="remotePath" [(ngModel)]="remotePath" required
                           [disabled]="isBusy" placeholder="/var/tmp/file.tar.gz" />
                </label>
                <label>Private key path (optional)
                    <input class="form-control" name="identityFile" [(ngModel)]="identityFile"
                           [disabled]="isBusy" placeholder="~/.ssh/id_ed25519" />
                </label>
                <div class="scp-options">
                    <label><input type="checkbox" name="recursive" [(ngModel)]="recursive" [disabled]="isBusy" /> Directories (-r)</label>
                    <label><input type="checkbox" name="preserveTimes" [(ngModel)]="preserveTimes" [disabled]="isBusy" /> Preserve timestamps (-p)</label>
                    <label><input type="checkbox" name="compress" [(ngModel)]="compress" [disabled]="isBusy" /> Compression (-C)</label>
                    <label *ngIf="direction === 'download'"><input type="checkbox" name="allowUnverifiedRemoteNames" [(ngModel)]="allowUnverifiedRemoteNames" [disabled]="isBusy" /> Trust complex remote names (-T: disables filename verification)</label>
                </div>
                <label class="scp-confirm">
                    <input type="checkbox" name="confirmOverwrite" [(ngModel)]="confirmOverwrite" [disabled]="isBusy" />
                    I checked both paths and understand that SCP can overwrite existing files.
                </label>
                <p class="text-muted small">
                    SSH host verification stays enabled. Configure your host key and noninteractive key/agent authentication beforehand.
                </p>
                <p class="scp-state" role="status" aria-live="polite">{{statusText}}</p>
                <div class="alert alert-danger" *ngIf="error" role="alert">{{error}}</div>
                <div *ngIf="logText">
                    <label for="scp-transfer-log">Transfer output</label>
                    <pre id="scp-transfer-log" class="scp-log" tabindex="0">{{logText}}</pre>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-outline-danger" *ngIf="isBusy" [disabled]="cancelling" (click)="cancel()">
                    {{cancelling ? 'Stopping…' : 'Cancel transfer'}}
                </button>
                <button type="button" class="btn btn-secondary" [disabled]="isBusy" (click)="close()">Close</button>
                <button type="submit" class="btn btn-primary" [disabled]="isBusy || !confirmOverwrite">
                    {{direction === 'upload' ? 'Upload' : 'Download'}}
                </button>
            </div>
        </form>
    `,
    styles: [`
        .scp-dialog { max-height: 70vh; overflow-y: auto; }
        .scp-dialog label { display: block; margin-bottom: .75rem; font-size: .9rem; }
        .scp-dialog label .form-control { margin-top: .3rem; }
        .scp-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0 1rem; }
        .scp-options { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-bottom: .75rem; }
        .scp-options label { margin: 0; }
        .scp-confirm { display: flex !important; align-items: flex-start; gap: .5rem; font-weight: 600; }
        .scp-confirm input { margin-top: .25rem; flex-shrink: 0; }
        .scp-log { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow-y: auto;
                   border: 1px solid var(--bs-border-color, #5555); border-radius: .25rem; padding: .5rem; font-size: .78rem; }
        .scp-state { font-weight: 600; }
    `],
})
export class ScpTransferDialogComponent implements OnDestroy {
    direction: ScpDirection = 'upload'
    host = ''
    username = ''
    port = ''
    localPath = ''
    remotePath = '/tmp/'
    identityFile = ''
    recursive = false
    preserveTimes = false
    compress = false
    allowUnverifiedRemoteNames = false
    confirmOverwrite = false
    logText = ''
    error = ''
    statusText = 'Ready'
    isBusy = false
    cancelling = false
    private task: ScpTask | null = null

    constructor(public activeModal: NgbActiveModal, private zone: NgZone) {}

    start(): void {
        if (this.isBusy || !this.confirmOverwrite) return
        const input: ScpTransferOptions = {
            direction: this.direction,
            host: this.host,
            username: this.username,
            port: this.port,
            localPath: this.localPath,
            remotePath: this.remotePath,
            identityFile: this.identityFile,
            recursive: this.recursive,
            preserveTimes: this.preserveTimes,
            compress: this.compress,
            allowUnverifiedRemoteNames: this.allowUnverifiedRemoteNames,
        }
        this.error = ''
        this.logText = ''
        try {
            const task = startScpTransfer(input, (chunk, stream) => {
                this.zone.run(() => {
                    // Bound memory: never accumulate unbounded logs from a noisy child.
                    this.logText = (this.logText + (stream === 'stderr' ? '' : '[stdout] ') + chunk).slice(-64000)
                })
            })
            this.task = task
            this.isBusy = true
            this.cancelling = false
            this.statusText = 'Transferring…'
            task.completed.then(result => this.zone.run(() => {
                this.task = null
                this.isBusy = false
                this.cancelling = false
                this.confirmOverwrite = false // require a fresh confirmation for retries
                this.statusText = result.cancelled ? 'Transfer cancelled'
                    : result.ok ? 'Transfer completed' : 'Transfer failed'
                if (!result.ok) this.error = result.error || 'SCP transfer failed'
            }))
        } catch (error: unknown) {
            this.task = null
            this.isBusy = false
            this.statusText = 'Unable to start transfer'
            this.error = error instanceof Error ? error.message : String(error)
        }
    }

    cancel(): void {
        if (!this.task || !this.isBusy || this.cancelling) return
        this.cancelling = true
        this.statusText = 'Cancelling transfer…'
        if (!this.task.cancel()) {
            this.cancelling = false
            this.statusText = 'Could not stop SCP process; check it before closing'
        }
    }

    close(): void {
        if (!this.isBusy) this.activeModal.close()
    }

    ngOnDestroy(): void {
        this.task?.cancel()
    }
}
