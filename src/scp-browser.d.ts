import { ScpTransferOptions } from './scp-core';

export interface ScpFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size?: number;
  modifiedAt?: number;
  mode?: string;
}

export function joinRemoteDirectory(directory: string, name: string): string;
export function parentRemoteDirectory(directory: string): string;
export function listLocalDirectory(directory: string): Promise<{ directory: string; entries: ScpFileEntry[] }>;
export function listRemoteDirectory(input: ScpTransferOptions, directory: string): Promise<{ directory: string; entries: ScpFileEntry[] }>;
export function moveLocalEntry(source: string, destination: string): Promise<void>;
export function moveRemoteEntry(input: ScpTransferOptions, source: string, destination: string): Promise<void>;

export function createRemoteDirectory(input: ScpTransferOptions, directory: string): Promise<void>;
export function createLocalDirectory(directory: string): Promise<void>;
