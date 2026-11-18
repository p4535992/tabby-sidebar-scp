export type ScpDirection = 'upload' | 'download';

export interface ScpTransferOptions {
  direction: ScpDirection;
  host: string;
  username?: string;
  port?: string | number;
  localPath: string;
  remotePath: string;
  identityFile?: string;
  recursive?: boolean;
  preserveTimes?: boolean;
  compress?: boolean;
  /** Explicit trust for complex legacy SCP download names; sets scp -T. */
  allowUnverifiedRemoteNames?: boolean;
}

export interface ScpTransferResult {
  ok: boolean;
  cancelled: boolean;
  exitCode: number | null;
  signal?: string | null;
  error: string;
}

export interface ScpTask {
  completed: Promise<ScpTransferResult>;
  cancel(): boolean;
}

export function startScpTransfer(
  input: ScpTransferOptions,
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void,
): ScpTask;

export function validateConnection(input: ScpTransferOptions): { host: string; username: string; port: number | null; identityFile: string | null; endpoint: string };
export function resolveLocalPath(value: string, fieldName: string): string;
export function quoteRemotePath(value: string): string;
