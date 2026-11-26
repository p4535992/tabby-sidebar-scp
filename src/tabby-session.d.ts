import { AppService, BaseTabComponent } from 'tabby-core';

/** The subset of a russh channel this plugin needs. */
export interface RemoteChannelLike {
  data$: { subscribe(next: (chunk: Uint8Array) => void): { unsubscribe(): void } };
  extendedData$: { subscribe(next: (event: [number, Uint8Array]) => void): { unsubscribe(): void } };
  eof$: { subscribe(next: () => void): { unsubscribe(): void } };
  closed$: { subscribe(next: () => void): { unsubscribe(): void } };
  requestExec(command: string): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** The authenticated russh client stored on the Tabby SSH session. */
export interface SshClientLike {
  openSessionChannel(): Promise<unknown>;
  activateChannel(channel: unknown): Promise<RemoteChannelLike>;
}

export interface SshSessionLike {
  open?: boolean;
  ssh?: SshClientLike;
  openSFTP?(): Promise<unknown>;
}

export interface SshProfileLike {
  name?: string;
  options?: {
    host?: string;
    user?: string;
    port?: number;
  };
}

export interface SshTabLike extends BaseTabComponent {
  sshSession: SshSessionLike;
  session?: { getWorkingDirectory?(): Promise<string | null> } | null;
  profile?: SshProfileLike;
  sessionChanged$?: { subscribe(next: () => void): { unsubscribe(): void } };
}

export function isSshTab(tab: BaseTabComponent | null | undefined): tab is SshTabLike;
export function isLiveSshTab(tab: BaseTabComponent | null | undefined): tab is SshTabLike;
export function focusedTab(app: AppService): BaseTabComponent | null;
export function resolveActiveSshTab(app: AppService): SshTabLike | null;
export function sessionLabel(tab: SshTabLike | null): string;
export function sessionEndpoint(tab: SshTabLike | null): string;
