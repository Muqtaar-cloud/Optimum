import type { Config } from './config.js';
import type { Notifier } from './notify.js';
import type { State } from './state.js';

export async function startBot(_cfg: Config, _state: State, _notify: Notifier, _signal: AbortSignal): Promise<(codes: string[]) => Promise<void>> {
  throw new Error('Stage 2 is not built yet; set STAGE=1');
}
