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
      <!-- In Better Sidebar the host provides Profiles | SFTP | SCP; only standalone mode needs this header. -->
      <div class="scp-own-header" role="tablist" aria-label="Sidebar views">
        <span class="scp-own-tab" role="tab" aria-selected="true"><i class="fas fa-exchange-alt" aria-hidden="true"></i> SCP</span>
      </div>
      <div class="scp-browser-shell">
        <!-- Same visual hierarchy as Better Sidebar's SFTP view: session, toolbar, path, listing. -->
        <div class="scp-topbar" aria-label="SCP toolbar">
          <div class="scp-session" [title]="host || 'No SSH host selected'">
            <i class="fas fa-server" aria-hidden="true"></i>
            <span class="scp-session-label">{{host || 'Select SSH host'}}</span>
            <span class="scp-protocol-label">SCP</span>
          </div>
          <div class="scp-toolbar-actions">
            <button type="button" class="scp-icon-button" [attr.aria-pressed]="showConnection"
              (click)="showConnection = !showConnection" title="SSH connection settings" aria-label="SSH connection settings">
              <i class="fas fa-sliders-h" aria-hidden="true"></i>
            </button>
            <button type="button" class="scp-icon-button" (click)="refreshCurrent()"
              [disabled]="busy" title="Refresh files" aria-label="Refresh files">
              <i class="fas fa-sync-alt" aria-hidden="true"></i>
            </button>
            <button type="button" class="scp-icon-button" (click)="openAdvanced()"
              title="Advanced file transfer" aria-label="Advanced transfer dialog">
              <i class="fas fa-ellipsis-v" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <!-- Connection settings are available but do not dominate the default file browser. -->
        <div class="scp-connection" *ngIf="showConnection" aria-label="SSH connection settings">
          <label>Host / SSH alias
            <input class="form-control form-control-sm" [(ngModel)]="host" placeholder="example-host" (keyup.enter)="refreshRemote()">
          </label>
          <label>Username
            <input class="form-control form-control-sm" [(ngModel)]="username" placeholder="SSH config" (keyup.enter)="refreshRemote()">
          </label>
          <label>Port
            <input class="form-control form-control-sm" [(ngModel)]="port" placeholder="SSH config" (keyup.enter)="refreshRemote()">
          </label>
          <label>Private key
            <input class="form-control form-control-sm" [(ngModel)]="identityFile" placeholder="Agent / SSH config" (keyup.enter)="refreshRemote()">
          </label>
          <div class="scp-connection-footer">
            <button type="button" class="btn btn-sm btn-primary" [disabled]="!host || busy" (click)="connectRemote()">Load remote files</button>
            <small>Uses local SSH keys, not Tabby's saved passwords.</small>
          </div>
        </div>

        <div class="scp-view-options" aria-label="File browser views">
          <div class="scp-view-modes" role="group" aria-label="Choose file view">
            <button type="button" class="scp-mode-button" [class.active]="viewMode === 'remote'"
              [attr.aria-pressed]="viewMode === 'remote'" (click)="setViewMode('remote')" title="Remote files, like SFTP">Remote</button>
            <button type="button" class="scp-mode-button" [class.active]="viewMode === 'local'"
              [attr.aria-pressed]="viewMode === 'local'" (click)="setViewMode('local')" title="Local files">Local</button>
            <button type="button" class="scp-mode-button" [class.active]="viewMode === 'split'"
              [attr.aria-pressed]="viewMode === 'split'" (click)="setViewMode('split')" title="Show both file lists">Split</button>
          </div>
          <div class="scp-view-buttons">
            <button type="button" class="scp-icon-button" [attr.aria-pressed]="showHidden" (click)="showHidden = !showHidden"
              title="Toggle hidden files" aria-label="Toggle hidden files"><i class="fas fa-eye" aria-hidden="true"></i></button>
            <button type="button" class="scp-icon-button" [attr.aria-pressed]="sortDescending" (click)="sortDescending = !sortDescending"
              title="Reverse sort order" aria-label="Reverse sort order"><i class="fas fa-sort-alpha-down" aria-hidden="true"></i></button>
          </div>
        </div>

        <label class="scp-filter" aria-label="Filter filenames">
          <i class="fas fa-search" aria-hidden="true"></i>
          <input type="text" [(ngModel)]="filter" placeholder="Filter files..." aria-label="Filter files">
          <button *ngIf="filter" class="scp-icon-button" type="button" (click)="filter = ''" aria-label="Clear filter">×</button>
        </label>

        <div class="scp-browser-panes" [class.scp-split]="viewMode === 'split'">
          <section class="scp-browser-pane" *ngIf="viewMode !== 'local'" aria-label="Remote files"
            (dragover)="allowDrop($event)" (drop)="onDrop('remote', null, $event)">
            <div class="scp-pathbar">
              <button class="scp-icon-button" type="button" title="Parent folder" aria-label="Remote parent folder" (click)="remoteUp()">
                <i class="fas fa-level-up-alt" aria-hidden="true"></i>
              </button>
              <input type="text" class="form-control form-control-sm" aria-label="Remote directory" [(ngModel)]="remoteDirectory"
                (keyup.enter)="refreshRemote()" title="Remote directory path">
              <button class="scp-icon-button" type="button" title="Refresh remote" aria-label="Refresh remote" (click)="refreshRemote()">
                <i class="fas fa-sync-alt" aria-hidden="true"></i>
              </button>
            </div>
            <div class="scp-file-header">
              <button type="button" (click)="setSort('name')">Name <i *ngIf="sortKey === 'name'" class="fas fa-sort" aria-hidden="true"></i></button>
              <button type="button" (click)="setSort('size')">Size</button>
              <button type="button" (click)="setSort('date')">Modified</button>
            </div>
            <div class="scp-error" role="alert" *ngIf="remoteError">{{remoteError}}</div>
            <div class="scp-file-list" role="listbox" aria-label="Remote entries" [attr.aria-busy]="loadingRemote">
              <button type="button" class="scp-file-row" *ngFor="let entry of displayedRemoteEntries"
                [class.scp-selected]="selectedRemote?.path === entry.path" [attr.aria-selected]="selectedRemote?.path === entry.path"
                [title]="entry.path" draggable="true" (dragstart)="onDrag('remote', entry, $event)"
                (click)="selectEntry('remote', entry)" (dblclick)="openEntry('remote', entry)"
                (contextmenu)="onEntryContextMenu('remote', entry, $event)"
                (dragover)="entry.isDirectory && allowDrop($event)" (drop)="onDrop('remote', entry, $event)">
                <span class="scp-file-name"><i [class]="entryIcon(entry)" aria-hidden="true"></i> <span>{{entry.name}}</span></span>
                <span class="scp-file-size">{{sizeText(entry.size)}}</span>
                <span class="scp-file-date">{{dateText(entry.modifiedAt)}}</span>
              </button>
              <p class="scp-empty" *ngIf="!loadingRemote && !displayedRemoteEntries.length">
                {{!host ? 'Set an SSH host using the settings button, then refresh.' : remoteEntries.length ? 'No matching files' : 'No files yet — refresh to load.'}}
              </p>
            </div>
          </section>

          <section class="scp-browser-pane" *ngIf="viewMode !== 'remote'" aria-label="Local files"
            (dragover)="allowDrop($event)" (drop)="onDrop('local', null, $event)">
            <div class="scp-pathbar">
              <button class="scp-icon-button" type="button" title="Parent folder" aria-label="Local parent folder" (click)="localUp()">
                <i class="fas fa-level-up-alt" aria-hidden="true"></i>
              </button>
              <input type="text" class="form-control form-control-sm" aria-label="Local directory" [(ngModel)]="localDirectory"
                (keyup.enter)="refreshLocal()" title="Local directory path">
              <button class="scp-icon-button" type="button" title="Refresh local" aria-label="Refresh local" (click)="refreshLocal()">
                <i class="fas fa-sync-alt" aria-hidden="true"></i>
              </button>
            </div>
            <div class="scp-file-header">
              <button type="button" (click)="setSort('name')">Name <i *ngIf="sortKey === 'name'" class="fas fa-sort" aria-hidden="true"></i></button>
              <button type="button" (click)="setSort('size')">Size</button>
              <button type="button" (click)="setSort('date')">Modified</button>
            </div>
            <div class="scp-error" role="alert" *ngIf="localError">{{localError}}</div>
            <div class="scp-file-list" role="listbox" aria-label="Local entries" [attr.aria-busy]="loadingLocal">
              <button type="button" class="scp-file-row" *ngFor="let entry of displayedLocalEntries"
                [class.scp-selected]="selectedLocal?.path === entry.path" [attr.aria-selected]="selectedLocal?.path === entry.path"
                [title]="entry.path" draggable="true" (dragstart)="onDrag('local', entry, $event)"
                (click)="selectEntry('local', entry)" (dblclick)="openEntry('local', entry)"
                (contextmenu)="onEntryContextMenu('local', entry, $event)"
                (dragover)="entry.isDirectory && allowDrop($event)" (drop)="onDrop('local', entry, $event)">
                <span class="scp-file-name"><i [class]="entryIcon(entry)" aria-hidden="true"></i> <span>{{entry.name}}</span></span>
                <span class="scp-file-size">{{sizeText(entry.size)}}</span>
                <span class="scp-file-date">{{dateText(entry.modifiedAt)}}</span>
              </button>
              <p class="scp-empty" *ngIf="!loadingLocal && !displayedLocalEntries.length">{{localEntries.length ? 'No matching files' : 'No files in this directory'}}</p>
            </div>
          </section>
        </div>

        <!-- The same compact footer for either view; actions follow selection. -->
        <div class="scp-command-bar" aria-label="File actions">
          <button type="button" class="scp-command-button" (click)="requestUpload()" [disabled]="busy || !host"
            title="Copy selected local file to remote directory"><i class="fas fa-upload" aria-hidden="true"></i> Upload</button>
          <button type="button" class="scp-command-button" (click)="requestDownload()" [disabled]="busy || !selectedRemote || !host"
            title="Copy selected remote file to local directory"><i class="fas fa-download" aria-hidden="true"></i> Download</button>
          <button type="button" class="scp-command-button" (click)="renameEntry(activeSide)" [disabled]="busy || !activeEntry"
            title="Rename or move selected entry"><i class="fas fa-i-cursor" aria-hidden="true"></i> Rename</button>
          <button type="button" class="scp-command-button" (click)="setViewMode('split')" title="Two-pane transfer view">
            <i class="fas fa-columns" aria-hidden="true"></i> Two panes</button>
        </div>
        <div class="scp-status" role="status" aria-live="polite">
          <span class="scp-status-indicator" [class.busy]="busy"></span>
          <span>{{status}}</span>
          <button *ngIf="busy" type="button" class="scp-icon-button" (click)="cancel()" title="Cancel transfer">Cancel</button>
        </div>
        <div class="scp-error" role="alert" *ngIf="error">{{error}}</div>
        <pre class="scp-output" *ngIf="output" tabindex="0">{{output}}</pre>
        <small class="scp-tip" *ngIf="viewMode === 'split'">Drag files between panes to copy; drop onto a folder in the same pane to move. Copies keep the source.</small>
      </div>

      <div *ngIf="contextMenu" class="scp-context-menu" role="menu" [style.left.px]="contextMenu.x" [style.top.px]="contextMenu.y">
        <button type="button" role="menuitem" *ngIf="contextMenu.entry.isDirectory" (click)="contextOpen()"><i class="fas fa-folder-open" aria-hidden="true"></i> Open</button>
        <button type="button" role="menuitem" (click)="contextCopy()"><i class="fas fa-copy" aria-hidden="true"></i> {{contextMenu.side === 'remote' ? 'Download' : 'Upload'}}</button>
        <button type="button" role="menuitem" (click)="contextRename()"><i class="fas fa-i-cursor" aria-hidden="true"></i> Rename / move</button>
        <button type="button" role="menuitem" (click)="closeContextMenu()">Cancel</button>
      </div>
    `,
    styles: [`
      :host { display: flex; flex-direction: column; min-height: 0; min-width: 260px; height: 100%; overflow: hidden; font-size: 12px; color: inherit; }
      :host(.scp-standalone) { flex: 0 0 330px; width: 330px; max-width: 45vw; border-right: 1px solid #8885; background: var(--bs-body-bg, var(--theme-bg, transparent)); }
      :host(.scp-embedded) { flex: 1 1 auto; min-height: 0; width: 100%; height: auto; }
      :host(.scp-embedded) .scp-own-header { display: none; }
      .scp-own-header { padding: 8px 8px 2px; }
      .scp-own-tab { display: inline-block; padding: 4px 12px; border-radius: 4px 4px 0 0; border-bottom: 2px solid var(--theme-accent, #64aaf5); font-weight: 600; }
      .scp-browser-shell { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 6px; gap: 5px; }
      .scp-topbar { display: flex; min-height: 30px; align-items: center; justify-content: space-between; gap: 3px; }
      .scp-session { min-width: 0; display: flex; align-items: center; gap: 6px; padding-left: 4px; }
      .scp-session-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .scp-protocol-label { border: 1px solid #7775; font-size: 10px; border-radius: 3px; padding: 1px 4px; opacity: .85; }
      .scp-toolbar-actions, .scp-view-buttons { display: flex; gap: 2px; flex-shrink: 0; }
      .scp-icon-button { padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
      .scp-icon-button:hover, .scp-command-button:hover, .scp-mode-button:hover { background: #80808028; }
      .scp-icon-button:disabled, .scp-command-button:disabled { opacity: .45; cursor: not-allowed; }
      .scp-connection { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px; padding: 8px; border: 1px solid #8884; border-radius: 4px; }
      .scp-connection label { min-width: 0; margin: 0; font-size: 11px; }
      .scp-connection input { width: 100%; min-width: 0; }
      .scp-connection-footer { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .scp-connection-footer small { opacity: .75; }
      .scp-view-options { display: flex; justify-content: space-between; align-items: center; gap: 4px; border-bottom: 1px solid #8884; padding-bottom: 3px; }
      .scp-view-modes { display: flex; min-width: 0; gap: 2px; }
      .scp-mode-button { background: transparent; color: inherit; border: 0; padding: 4px 9px; border-radius: 4px; font-size: 12px; cursor: pointer; }
      .scp-mode-button.active { background: #5386cb45; box-shadow: inset 0 -2px var(--theme-accent, #64aaf5); }
      .scp-filter { display: flex; gap: 6px; align-items: center; min-height: 27px; padding: 3px 8px; border: 1px solid #8885; border-radius: 4px; margin: 0; }
      .scp-filter input { background: transparent; border: 0; outline: none; color: inherit; width: 100%; min-width: 0; font-size: 12px; }
      .scp-browser-panes { display: flex; flex: 1; min-height: 120px; flex-direction: column; gap: 6px; }
      .scp-browser-panes.scp-split .scp-browser-pane { min-height: 100px; }
      .scp-browser-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; border: 1px solid #8884; border-radius: 4px; }
      .scp-pathbar { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid #8884; padding: 3px; }
      .scp-pathbar input { min-width: 0; flex: 1; border: none; background: transparent; color: inherit; font-size: 11px; }
      .scp-file-header, .scp-file-row { display: grid; grid-template-columns: minmax(0,1fr) 49px 65px; align-items: center; gap: 3px; }
      .scp-file-header { min-height: 27px; color: inherit; background: #8882; border-bottom: 1px solid #8884; }
      .scp-file-header button { text-align: left; background: transparent; border: none; color: inherit; opacity: .85; font-size: 10px; padding: 3px 5px; white-space: nowrap; cursor: pointer; }
      .scp-file-header button + button { border-left: 1px solid #8883; }
      .scp-file-list { flex: 1; min-height: 0; overflow: auto; }
      .scp-file-row { width: 100%; border: none; border-bottom: 1px solid #8881; padding: 5px; background: transparent; color: inherit; text-align: left; font-size: 11px; cursor: pointer; }
      .scp-file-row:nth-child(even) { background: #8881; }
      .scp-file-row:hover { background: #8080802c; }
      .scp-file-row.scp-selected { background: #4287d34d; }
      .scp-file-name { min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
      .scp-file-name > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .scp-file-name .fa-folder { color: #e5bb69; }
      .scp-file-size, .scp-file-date { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .74; font-size: 10px; }
      .scp-empty { text-align: center; padding: 16px 9px; opacity: .7; font-size: 11px; }
      .scp-command-bar { display: flex; gap: 3px; flex-wrap: wrap; border-top: 1px solid #8884; padding-top: 5px; }
      .scp-command-button { border: 1px solid #8885; background: transparent; color: inherit; border-radius: 4px; padding: 5px 7px; font-size: 11px; cursor: pointer; }
      .scp-status { min-height: 19px; display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .85; overflow-wrap: anywhere; }
      .scp-status-indicator { width: 6px; height: 6px; flex: none; border-radius: 50%; background: #777; }
      .scp-status-indicator.busy { background: #e3aa43; }
      .scp-error { color: #ee7171; padding: 2px 5px; overflow-wrap: anywhere; }
      .scp-output { max-height: 100px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 10px; border: 1px solid #8884; padding: 5px; }
      .scp-tip { opacity: .7; font-size: 10px; }
      .scp-context-menu { position: fixed; z-index: 100000; display: flex; flex-direction: column; min-width: 140px; max-width: 220px; padding: 4px; background: var(--bs-body-bg, #262626); color: inherit; border: 1px solid #8888; box-shadow: 0 6px 18px #0005; border-radius: 5px; }
      .scp-context-menu button { background: transparent; color: inherit; border: none; text-align: left; padding: 7px; font-size: 12px; cursor: pointer; }
      .scp-context-menu button:hover { background: #8080803f; }
      @media (max-height: 600px) { .scp-filter { display: none; } }
    `],
})
export class ScpBrowserComponent implements OnInit, OnDestroy {
    host = ''
    viewMode: 'remote' | 'local' | 'split' = 'remote'
    showConnection = false
    showHidden = true
    sortKey: 'name' | 'size' | 'date' = 'name'
    sortDescending = false
    filter = ''
    activeSide: Side = 'remote'
    contextMenu: { side: Side; entry: ScpFileEntry; x: number; y: number } | null = null
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


    get activeEntry(): ScpFileEntry | null {
        return this.activeSide === 'remote' ? this.selectedRemote : this.selectedLocal
    }

    get displayedRemoteEntries(): ScpFileEntry[] { return this.displayEntries(this.remoteEntries) }
    get displayedLocalEntries(): ScpFileEntry[] { return this.displayEntries(this.localEntries) }

    private displayEntries(entries: ScpFileEntry[]): ScpFileEntry[] {
        const filter = this.filter.trim().toLocaleLowerCase()
        return entries.filter(e => (this.showHidden || !e.name.startsWith('.'))
            && (!filter || e.name.toLocaleLowerCase().includes(filter)))
            .slice().sort((a, b) => {
                const folderOrder = Number(b.isDirectory) - Number(a.isDirectory)
                if (folderOrder) return folderOrder
                let comparison = 0
                if (this.sortKey === 'size') comparison = (a.size ?? -1) - (b.size ?? -1)
                else if (this.sortKey === 'date') comparison = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0)
                else comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                return (this.sortDescending ? -1 : 1) * comparison
            })
    }

    entryIcon(entry: ScpFileEntry): string {
        return entry.isSymbolicLink ? 'fas fa-link' : entry.isDirectory ? 'fas fa-folder' : 'far fa-file'
    }

    sizeText(size?: number): string {
        if (size === undefined || !Number.isFinite(size)) return '—'
        if (size < 1024) return `${size} B`
        const units = ['KB', 'MB', 'GB', 'TB']
        let value = size
        let index = -1
        do { value /= 1024; index++ } while (value >= 1024 && index < units.length - 1)
        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
    }

    dateText(value?: number): string {
        if (!value || !Number.isFinite(value)) return '—'
        return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' })
    }

    setSort(key: 'name' | 'size' | 'date'): void {
        if (this.sortKey === key) this.sortDescending = !this.sortDescending
        else { this.sortKey = key; this.sortDescending = key !== 'name' }
    }

    setViewMode(mode: 'remote' | 'local' | 'split'): void {
        this.viewMode = mode
        this.activeSide = mode === 'local' ? 'local' : 'remote'
        this.closeContextMenu()
    }

    refreshCurrent(): void {
        if (this.viewMode !== 'local') void this.refreshRemote()
        if (this.viewMode !== 'remote') void this.refreshLocal()
    }

    connectRemote(): void {
        if (!this.host.trim()) return
        this.showConnection = false
        this.setViewMode('remote')
        void this.refreshRemote()
    }

    selectEntry(side: Side, entry: ScpFileEntry): void {
        this.activeSide = side
        if (side === 'remote') this.selectedRemote = entry
        else this.selectedLocal = entry
        this.closeContextMenu()
    }

    requestUpload(): void {
        if (!this.selectedLocal) {
            this.setViewMode('local')
            this.status = 'Choose a local file, then click Upload.'
            return
        }
        this.copySelected('upload')
    }

    requestDownload(): void {
        if (!this.selectedRemote) return
        this.copySelected('download')
    }

    onEntryContextMenu(side: Side, entry: ScpFileEntry, event: MouseEvent): void {
        event.preventDefault()
        this.selectEntry(side, entry)
        this.contextMenu = { side, entry, x: Math.min(event.clientX, window.innerWidth - 220),
            y: Math.min(event.clientY, window.innerHeight - 180) }
    }

    closeContextMenu(): void { this.contextMenu = null }

    contextOpen(): void {
        const item = this.contextMenu
        this.closeContextMenu()
        if (item) this.openEntry(item.side, item.entry)
    }

    contextCopy(): void {
        const item = this.contextMenu
        this.closeContextMenu()
        if (item) this.copySelected(item.side === 'remote' ? 'download' : 'upload')
    }

    contextRename(): void {
        const item = this.contextMenu
        this.closeContextMenu()
        if (item) void this.renameEntry(item.side)
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
        const complexDownload = !upload && !/^\/[A-Za-z0-9_./-]+$/.test(source)
        if (complexDownload && !window.confirm(
            'Legacy SCP requires -T for this filename, disabling remote filename checks. Only proceed if you trust this SSH server. Continue?',
        )) return
        const options: ScpTransferOptions = {
            ...this.connection, direction,
            allowUnverifiedRemoteNames: complexDownload,
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
