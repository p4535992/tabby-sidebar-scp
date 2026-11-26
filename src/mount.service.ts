import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, OnDestroy, createComponent } from '@angular/core'
import { AppService, ConfigService } from 'tabby-core'
import { ScpBrowserComponent } from './scp-browser.component'

/**
 * Best-effort optional compatibility adapter. Better Sidebar does not expose a
 * public extension point for its Profiles/SFTP view bar. We only insert a new
 * tab and temporarily hide existing content while selected; no reparenting of
 * Better Sidebar's Angular children, no imports from another plugin.
 * If its DOM changes, the full standalone sidebar remains available.
 */
@Injectable({ providedIn: 'root' })
export class ScpMountService implements OnDestroy {
    private ref: ComponentRef<ScpBrowserComponent> | null = null
    private observer: MutationObserver | null = null
    private timer: ReturnType<typeof setTimeout> | null = null
    private mode: 'embedded' | 'standalone' | null = null
    private betterContent: HTMLElement | null = null
    private betterHeader: HTMLElement | null = null
    private tab: HTMLAnchorElement | null = null
    private selected = false
    private enabled = true
    private hidden = new Map<HTMLElement, { value: string; priority: string }>()
    private previousActive = new Map<Element, boolean>()
    private readonly onOtherTab = (event: Event): void => {
        const target = event.target as HTMLElement | null
        if (target?.closest('.view-mode-tab') && !target.closest('[data-tabby-scp-tab]')) this.deactivate()
    }

    constructor(
        private app: AppService,
        private config: ConfigService,
        private application: ApplicationRef,
        private environment: EnvironmentInjector,
    ) {
        this.app.ready$.subscribe(() => {
            this.enabled = this.readEnabled()
            this.sync()
            this.observer = new MutationObserver(() => this.schedule())
            this.observer.observe(document.body, { childList: true, subtree: true })
        })
        // The Settings checkbox saves the config; react without a restart.
        this.config.changed$.subscribe(() => this.applyConfig())
    }

    /** `scpSidebar.enabled` is true unless the user explicitly turned it off. */
    private readEnabled(): boolean {
        return this.config.store?.scpSidebar?.enabled !== false
    }

    private applyConfig(): void {
        const enabled = this.readEnabled()
        if (enabled === this.enabled) return
        this.enabled = enabled
        if (enabled) this.sync()
        else this.unmount()
    }

    /** Remove the tab and the component instance; the observer stays idle while disabled. */
    private unmount(): void {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        this.disconnectBetter()
        if (this.ref) {
            ;(this.ref.location.nativeElement as HTMLElement).remove()
            this.application.detachView(this.ref.hostView)
            this.ref.destroy()
            this.ref = null
        }
    }

    private schedule(): void {
        if (this.timer || !this.enabled) return
        this.timer = setTimeout(() => { this.timer = null; this.sync() }, 75)
    }

    private getRoot(): HTMLElement {
        if (!this.ref) {
            this.ref = createComponent(ScpBrowserComponent, { environmentInjector: this.environment })
            this.application.attachView(this.ref.hostView)
        }
        return this.ref.location.nativeElement as HTMLElement
    }

    private sync(): void {
        if (!this.enabled) return
        const header = document.querySelector<HTMLElement>('.sidebar-plus-content .view-mode-bar')
        const content = header?.parentElement ?? null
        const windowRow = document.querySelector<HTMLElement>('.window.h-100.d-flex')
        if (!windowRow && !content) return

        if (header && content?.classList.contains('sidebar-plus-content')) {
            if (this.mode !== 'embedded' || this.betterHeader !== header) {
                this.disconnectBetter()
                this.betterContent = content
                this.betterHeader = header
                const tab = document.createElement('a')
                tab.href = '#'
                tab.className = 'view-mode-tab'
                tab.dataset.tabbyScpTab = '1'
                tab.title = 'SCP file browser'
                tab.textContent = '⇄ SCP'
                tab.setAttribute('role', 'tab')
                tab.addEventListener('click', event => {
                    event.preventDefault()
                    this.activate()
                })
                header.addEventListener('click', this.onOtherTab, true)
                header.appendChild(tab)
                this.tab = tab
                const root = this.getRoot()
                root.classList.remove('scp-standalone')
                root.classList.add('scp-embedded')
                content.appendChild(root)
                this.mode = 'embedded'
                this.selected = false
                root.style.display = 'none'
            } else if (!header.contains(this.tab) && this.tab) {
                header.appendChild(this.tab)
            }
            if (this.selected) this.hideBetterChildren()
            return
        }

        if (windowRow && (this.mode !== 'standalone' || !windowRow.contains(this.getRoot()))) {
            this.disconnectBetter()
            const root = this.getRoot()
            root.classList.remove('scp-embedded')
            root.classList.add('scp-standalone')
            root.style.display = ''
            windowRow.insertBefore(root, windowRow.firstChild)
            this.mode = 'standalone'
        }
    }

    private hideBetterChildren(): void {
        if (!this.betterContent || !this.betterHeader) return
        const root = this.getRoot()
        for (const element of Array.from(this.betterContent.children) as HTMLElement[]) {
            if (element === this.betterHeader || element === root || this.hidden.has(element)) continue
            this.hidden.set(element, {
                value: element.style.getPropertyValue('display'),
                priority: element.style.getPropertyPriority('display'),
            })
            element.style.setProperty('display', 'none', 'important')
        }
    }

    private restoreBetterChildren(): void {
        for (const [element, before] of this.hidden) {
            if (before.value) element.style.setProperty('display', before.value, before.priority)
            else element.style.removeProperty('display')
        }
        this.hidden.clear()
    }

    private activate(): void {
        if (!this.tab || !this.betterContent || !this.betterHeader) return
        this.selected = true
        this.tab.classList.add('active')
        this.tab.setAttribute('aria-selected', 'true')
        this.previousActive.clear()
        for (const sibling of Array.from(this.betterHeader.querySelectorAll('.view-mode-tab'))) {
            if (sibling !== this.tab) {
                this.previousActive.set(sibling, sibling.classList.contains('active'))
                sibling.classList.remove('active')
            }
        }
        this.hideBetterChildren()
        this.getRoot().style.display = ''
    }

    private deactivate(): void {
        if (!this.selected) return
        this.selected = false
        this.tab?.classList.remove('active')
        this.tab?.setAttribute('aria-selected', 'false')
        for (const [sibling, wasActive] of this.previousActive) {
            sibling.classList.toggle('active', wasActive)
        }
        this.previousActive.clear()
        if (this.ref) (this.ref.location.nativeElement as HTMLElement).style.display = 'none'
        this.restoreBetterChildren()
    }

    private disconnectBetter(): void {
        this.deactivate()
        this.betterHeader?.removeEventListener('click', this.onOtherTab, true)
        this.restoreBetterChildren()
        this.tab?.remove()
        this.tab = null
        this.betterHeader = null
        this.betterContent = null
        this.mode = null
    }

    ngOnDestroy(): void {
        this.observer?.disconnect()
        this.unmount()
    }
}
