import { ScpFileEntry } from './scp-browser';
import { SshTabLike } from './tabby-session';

export interface ScpSessionTransferOptions {
  /** Required to download a remote directory. */
  recursive?: boolean;
  isCancelled?(): boolean;
  onProgress?(transferred: number, total?: number): void;
  onWarning?(message: string): void;
}

export function listSessionDirectory(tab: SshTabLike, directory: string): Promise<{ directory: string; entries: ScpFileEntry[] }>;
export function createSessionDirectory(tab: SshTabLike, directory: string): Promise<void>;
export function moveSessionEntry(tab: SshTabLike, source: string, destination: string): Promise<void>;
export function uploadSessionEntry(tab: SshTabLike, localPath: string, remotePath: string, options?: ScpSessionTransferOptions): Promise<void>;
export function downloadSessionEntry(tab: SshTabLike, remotePath: string, localPath: string, options?: ScpSessionTransferOptions): Promise<void>;
