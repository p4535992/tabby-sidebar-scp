import { Component, NgZone, OnDestroy, OnInit } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import * as os from 'node:os'
import * as path from 'node:path'
import { ScpTask, ScpTransferOptions, startScpTransfer } from './scp-core'
import {
    ScpFileEntry, joinRemoteDirectory, parentRemoteDirectory,
    listLocalDirectory, listRemoteDirectory, moveLocalEntry, moveRemoteEntry,
} from './scp-browser'
import { ScpTransferDialogComponent } from './scp-dialog.component'

const DRAG_TYPE = 'application/x-tabby-scp-entry'
type Side = 'local' | 'remote'

/** Lightweight two-pane file browser. SCP is used for copies; SSH for remote list/move. */
@Component({
    selector: 'tabby-scp-browser',
    template: `
      <div class="scp-own-header" role="tablist" aria-label="Sidebar views">
        <span class="scp-own-tab" role="tab" aria-selected="true"><i class="fas fa-exchange-alt"></i> SCP</span>
      </div>
      <div class="scp-body">
        <div class="scp-connection" aria-label="SSH connection settings">
          <label>Host / SSH alias <input class="form-control form-control-sm" [(ngModel)]="host" placeholder="example-host" (keyup.enter)="refreshRemote()"></label>
          <label>User <input class="form-control form-control-sm" [(ngModel)]="username" placeholder="SSH config" (keyup.enter)="refreshRemote()"></label>
          <label>Port <input class="form-control form-control-sm" [(ngModel)]="port" placeholder="SSH config" (keyup.enter)="refreshRemote()"></label>
          <label>Private key <input class="form-control form-control-sm" [(ngModel)]="identityFile" placeholder="agent / SSH config" (keyup.enter)="refreshRemote()"></label>
        </div>
        <div class="scp-browser-panes">
          <section class="scp-browser-pane" aria-label="Local files" (dragover)="allowDrop($event)" (drop)="onDrop('local', null, $event)">
            <div class="scp-pane-title">Local <button type="button" title="Refresh local" (click)="refreshLocal()">↻</button></div>
            <div class="scp-path">
              <button type="button" title="Parent folder" (click)="localUp()">↑</button>
              <input class="form-control form-control-sm" aria-label="Local directory" [(ngModel)]="localDirectory" (keyup.enter)="refreshLocal()">
            </div>
            <div class="scp-error" *ngIf="localError">{{localError}}</div>
            <div class="scp-list" role="listbox" aria-label="Local entries" [attr.aria-busy]="loadingLocal">
              <button type="button" class="scp-entry" *ngFor="let entry of localEntries"
                [class.scp-selected]="selectedLocal?.path === entry.path"
                [attr.aria-selected]="selectedLocal?.path === entry.path" [title]="entry.path"
                draggable="true" (dragstart)="onDrag('local', entry, $event)"
                (click)="selectedLocal = entry" (dblclick)="openEntry('local', entry)"
                (dragover)="entry.isDirectory && allowDrop($event)" (drop)="onDrop('local', entry, $event)">
                <i [class]="entry.isDirectory ? 'fas fa-folder' : 'far fa-file'"></i>
                <span>{{entry.name}}</span>
              </button>
              <p *ngIf="!loadingLocal && !localEntries.length" class="scp-hint">No entries</p>
            </div>
          </section>
          <section class="scp-browser-pane" aria-label="Remote files" (dragover)="allowDrop($event)" (drop)="onDrop('remote', null, $event)">
            <div class="scp-pane-title">Remote <button type="button" title="Refresh remote" (click)="refreshRemote()">↻</button></div>
            <div class="scp-path">
              <button type="button" title="Parent folder" (click)="remoteUp()">↑</button>
              <input class="form-control form-control-sm" aria-label="Remote directory" [(ngModel)]="remoteDirectory" (keyup.enter)="refreshRemote()">
            </div>
            <div class="scp-error" *ngIf="remoteError">{{remoteError}}</div>
            <div class="scp-list" role="listbox" aria-label="Remote entries" [attr.aria-busy]="loadingRemote">
              <button type="button" class="scp-entry" *ngFor="let entry of remoteEntries"
                [class.scp-selected]="selectedRemote?.path === entry.path"
                [attr.aria-selected]="selectedRemote?.path === entry.path" [title]="entry.path"
                draggable="true" (dragstart)="onDrag('remote', entry, $event)"
                (click)="selectedRemote = entry" (dblclick)="openEntry('remote', entry)"
                (dragover)="entry.isDirectory && allowDrop($event)" (drop)="onDrop('remote', entry, $event)">
                <i [class]="entry.isDirectory ? 'fas fa-folder' : 'far fa-file'"></i>
                <span>{{entry.name}}</span>
              </button>
              <p *ngIf="!loadingRemote && !remoteEntries.length" class="scp-hint">Refresh to load</p>
            </div>
          </section>
        </div>
        <div class="scp-actions">
          <button type="button" class="btn btn-sm btn-primary" [disabled]="busy || !selectedLocal || !host" (click)="copySelected('upload')" title="Copy selected local item to the current remote folder">Copy →</button>
          <button type="button" class="btn btn-sm btn-primary" [disabled]="busy || !selectedRemote || !host" (click)="copySelected('download')" title="Copy selected remote item to the current local folder">← Copy</button>
          <button type="button" class="btn btn-sm btn-secondary" [disabled]="busy || !selectedLocal" (click)="renameEntry('local')" title="Rename/move local file">Move local</button>
          <button type="button" class="btn btn-sm btn-secondary" [disabled]="busy || !selectedRemote || !host" (click)="renameEntry('remote')" title="Rename/move remote file">Move remote</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="openAdvanced()">Paths…</button>
        </div>
        <div class="scp-status" role="status" aria-live="polite">{{status}}</div>
        <div *ngIf="error" class="scp-error" role="alert">{{error}}</div>
        <div *ngIf="busy" class="scp-actions"><button type="button" class="btn btn-sm btn-danger" (click)="cancel()">Cancel transfer</button></div>
        <pre *ngIf="output" class="scp-output" tabindex="0">{{output}}</pre>
        <small class="scp-hint">Drag files between panes to copy. Drop on a folder in the same pane to move. Copies never delete their source.</small>
      </div>
    `,
    styles: [`
      :host { display: flex; flex-direction: column; min-height: 0; min-width: 260px; height: 100%; overflow: hidden; font-size: 12px; color: inherit; }
      :host(.scp-standalone) { flex: 0 0 330px; width: 330px; max-width: 45vw; border-right: 1px solid #8885; background: var(--bs-body-bg, var(--theme-bg, transparent)); }
      :host(.scp-embedded) { flex: 1 1 auto; min-height: 0; width: 100%; height: auto; }
      :host(.scp-embedded) .scp-own-header { display: none; }
      .scp-own-header { display: flex; padding: .5rem; border-bottom: 1px solid #8885; }
      .scp-own-tab { font-weight: 600; padding: .25rem .5rem; border-bottom: 2px solid currentColor; }
      .scp-body { display: flex; flex-direction: column; gap: .5rem; flex: 1; min-height: 0; padding: .5rem; overflow: auto; }
      .scp-connection { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: .35rem; }
      .scp-connection label { min-width: 0; margin: 0; }
      .scp-browser-panes { display: grid; grid-template-columns: 1fr; grid-template-rows: repeat(2, minmax(120px, 1fr)); gap: .35rem; min-height: 250px; flex: 1 1 auto; }
      .scp-browser-pane { display: flex; flex-direction: column; border: 1px solid #8885; border-radius: 4px; overflow: hidden; min-width: 0; min-height: 120px; }
      .scp-pane-title { display: flex; align-items: center; justify-content: space-between; padding: .2rem .35rem; font-weight: 600; border-bottom: 1px solid #8885; }
      .scp-pane-title button, .scp-path button { background: none; border: 0; color: inherit; cursor: pointer; }
      .scp-path { display: flex; border-bottom: 1px solid #8885; align-items: center; }
      .scp-path input { width: 100%; min-width: 0; font-size: 11px; }
      .scp-list { overflow: auto; min-height: 80px; flex: 1; }
      .scp-entry { display: flex; width: 100%; background: transparent; border: 0; padding: .25rem .3rem; gap: .25rem; text-align: left; color: inherit; align-items: center; overflow: hidden; cursor: pointer; }
      .scp-entry span { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
      .scp-entry:hover { background: #80808020; }
      .scp-entry.scp-selected { background: #3577b45c; }
      .scp-actions { display: flex; flex-wrap: wrap; gap: .25rem; }
      .scp-status { font-weight: 600; }
      .scp-error { color: #ef6767; overflow-wrap: anywhere; }
      .scp-output { max-height: 110px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; border: 1px solid #8885; padding: .3rem; }
      .scp-hint { opacity: .75; font-size: 11px; margin: .1rem; }
    `],
})
export class ScpBrowserComponent implements OnInit, OnDestroy {
    host = ''
    username = ''
    port = ''
    identityFile = ''
    localDirectory = os.homedir()
    remoteDirectory = '/tmp'
    localEntries: ScpFileEntry[] = []
    remoteEntries: ScpFileEntry[] = []
    selectedLocal: ScpFileEntry | null = null
    selectedRemote: ScpFileEntry | null = null
    localError = ''
    remoteError = ''
    loadingLocal = false
    loadingRemote = false
    error = ''
    output = ''
    status = 'Select a host, then refresh Remote.'
    busy = false
    private task: ScpTask | null = null
    private localRequest = 0
    private remoteRequest = 0
    private destroyed = false

    constructor(private zone: NgZone, private modal: NgbModal) {}

    ngOnInit(): void { void this.refreshLocal() }
    ngOnDestroy(): void {
        this.destroyed = true
        this.localRequest++
        this.remoteRequest++
        this.task?.cancel()
    }

    get connection(): ScpTransferOptions {
        return {
            host: this.host, username: this.username, port: this.port,
            identityFile: this.identityFile, direction: 'upload',
            localPath: this.localDirectory, remotePath: this.remoteDirectory,
        }
    }

    async refreshLocal(): Promise<void> {
        const request = ++this.localRequest
        this.loadingLocal = true; this.localError = ''
        try {
            const listing = await listLocalDirectory(this.localDirectory)
            this.zone.run(() => {
                if (request !== this.localRequest || this.destroyed) return
                this.localDirectory = listing.directory
                this.localEntries = listing.entries
                this.selectedLocal = null
            })
        } catch (e: unknown) {
            this.zone.run(() => { if (request === this.localRequest && !this.destroyed) this.localError = this.message(e) })
        } finally {
            this.zone.run(() => { if (request === this.localRequest && !this.destroyed) this.loadingLocal = false })
        }
    }

    async refreshRemote(): Promise<void> {
        const request = ++this.remoteRequest
        if (!this.host.trim()) { this.remoteError = 'Enter an SSH host first'; return }
        this.loadingRemote = true; this.remoteError = ''
        try {
            const listing = await listRemoteDirectory(this.connection, this.remoteDirectory)
            this.zone.run(() => {
                if (request !== this.remoteRequest || this.destroyed) return
                this.remoteEntries = listing.entries
                this.selectedRemote = null
            })
        } catch (e: unknown) {
            this.zone.run(() => { if (request === this.remoteRequest && !this.destroyed) this.remoteError = this.message(e) })
        } finally {
            this.zone.run(() => { if (request === this.remoteRequest && !this.destroyed) this.loadingRemote = false })
        }
    }

    localUp(): void { this.localDirectory = path.dirname(this.localDirectory); void this.refreshLocal() }
    remoteUp(): void { this.remoteDirectory = parentRemoteDirectory(this.remoteDirectory); void this.refreshRemote() }

    openEntry(side: Side, entry: ScpFileEntry): void {
        if (!entry.isDirectory) return
        if (side === 'local') { this.localDirectory = entry.path; void this.refreshLocal() }
        else { this.remoteDirectory = entry.path; void this.refreshRemote() }
    }

    copySelected(direction: 'upload' | 'download'): void {
        const entry = direction === 'upload' ? this.selectedLocal : this.selectedRemote
        if (!entry) return
        const destination = direction === 'upload' ? this.remoteDirectory : this.localDirectory
        this.copyEntry(direction, entry, destination)
    }

    private copyEntry(direction: 'upload' | 'download', entry: ScpFileEntry, destinationDirectory: string): void {
        if (this.busy) return
        const upload = direction === 'upload'
        const source = entry.path
        const destination = upload
            ? joinRemoteDirectory(destinationDirectory, entry.name)
            : path.join(destinationDirectory, entry.name)
        if (!window.confirm(`Copy ${source} to ${destination}?\nExisting files may be overwritten. The original is retained.`)) return
        const options: ScpTransferOptions = {
            ...this.connection, direction,
            localPath: upload ? source : destination,
            remotePath: upload ? destination : source,
            recursive: entry.isDirectory,
        }
        try {
            this.error = ''; this.output = ''; this.status = 'Transferring…'
            this.task = startScpTransfer(options, chunk => this.zone.run(() => {
                if (!this.destroyed) this.output = (this.output + chunk).slice(-16000)
            }))
            this.busy = true
            this.task.completed.then(result => this.zone.run(() => {
                if (this.destroyed) return
                this.busy = false; this.task = null
                this.status = result.cancelled ? 'Cancelled' : result.ok ? 'Transfer completed' : 'Transfer failed'
                if (!result.ok) this.error = result.error || 'SCP failed'
                if (result.ok) {
                    if (upload) void this.refreshRemote()
                    else void this.refreshLocal()
                }
            }))
        } catch (e: unknown) {
            this.error = this.message(e); this.busy = false; this.task = null
            this.status = 'Unable to start SCP'
        }
    }

    async renameEntry(side: Side): Promise<void> {
        if (this.busy) return
        const entry = side === 'local' ? this.selectedLocal : this.selectedRemote
        if (!entry) return
        const newName = window.prompt(`New name for ${entry.name}`, entry.name)
        if (!newName || newName === entry.name) return
        if (newName === '.' || newName === '..' || /[\/\\\x00-\x1f\x7f]/.test(newName)) {
            this.error = 'Enter a filename without slashes or control characters'
            return
        }
        try {
            const destination = side === 'local'
                ? path.join(path.dirname(entry.path), newName)
                : joinRemoteDirectory(parentRemoteDirectory(entry.path), newName)
            await this.moveEntry(side, entry.path, destination)
        } catch (e: unknown) { this.error = this.message(e) }
    }

    private async moveEntry(side: Side, from: string, to: string): Promise<void> {
        if (this.busy) return
        if (!window.confirm(`Move ${from} to ${to}?\nThe original will be renamed/moved. Existing destinations are not overwritten.`)) return
        this.busy = true; this.error = ''; this.status = 'Moving…'
        try {
            if (side === 'local') await moveLocalEntry(from, to)
            else await moveRemoteEntry(this.connection, from, to)
            this.zone.run(() => {
                this.status = 'Move completed'
                if (side === 'local') void this.refreshLocal()
                else void this.refreshRemote()
            })
        } catch (e: unknown) {
            this.zone.run(() => { this.error = this.message(e); this.status = 'Move failed' })
        } finally { this.zone.run(() => { this.busy = false }) }
    }

    allowDrop(event: DragEvent): void { event.preventDefault() }
    onDrag(side: Side, entry: ScpFileEntry, event: DragEvent): void {
        if (!event.dataTransfer) return
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ side, path: entry.path, name: entry.name,
            isDirectory: entry.isDirectory, isSymbolicLink: entry.isSymbolicLink }))
        event.dataTransfer.effectAllowed = 'copyMove'
    }

    onDrop(side: Side, target: ScpFileEntry | null, event: DragEvent): void {
        event.preventDefault(); event.stopPropagation()
        if (this.busy || (target && !target.isDirectory)) return
        const raw = event.dataTransfer?.getData(DRAG_TYPE)
        if (!raw) return
        try {
            const item = JSON.parse(raw) as ScpFileEntry & { side: Side }
            if (!['local', 'remote'].includes(item.side)) return
            if (!item.path || !item.name) return
            const baseDir = target?.path ?? (side === 'local' ? this.localDirectory : this.remoteDirectory)
            if (item.side !== side) {
                const direction = item.side === 'local' ? 'upload' : 'download'
                this.copyEntry(direction, item, baseDir)
            } else if (target) {
                const destination = side === 'local' ? path.join(baseDir, item.name) : joinRemoteDirectory(baseDir, item.name)
                void this.moveEntry(side, item.path, destination)
            }
        } catch (e: unknown) { this.error = this.message(e) }
    }

    openAdvanced(): void { this.modal.open(ScpTransferDialogComponent, { size: 'lg' }) }
    cancel(): void { this.task?.cancel() }
    private message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
}
