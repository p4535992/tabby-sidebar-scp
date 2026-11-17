import { ScpTransferOptions } from './scp-core';

export interface ScpFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export function joinRemoteDirectory(directory: string, name: string): string;
export function parentRemoteDirectory(directory: string): string;
export function listLocalDirectory(directory: string): Promise<{ directory: string; entries: ScpFileEntry[] }>;
export function listRemoteDirectory(input: ScpTransferOptions, directory: string): Promise<{ directory: string; entries: ScpFileEntry[] }>;
export function moveLocalEntry(source: string, destination: string): Promise<void>;
export function moveRemoteEntry(input: ScpTransferOptions, source: string, destination: string): Promise<void>;
