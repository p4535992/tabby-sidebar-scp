import { ScpTransferOptions } from './scp-core';
export function readFavorites(storage: Storage | null, connection: ScpTransferOptions): string[];
export function toggleFavorite(storage: Storage | null, connection: ScpTransferOptions, remotePath: string): string[];
