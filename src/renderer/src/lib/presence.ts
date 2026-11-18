import type { Session } from '@shared/protocol';
import { STATUS_LABELS } from './format';

/**
 * A session's state as every screen shows it — one dot and one word, the same in the tree, on the card, in the
 * session header, the tabs and the lists:
 *   working  green, pulsing        (working, starting)
 *   needs    orange, slow pulse    (a question / permission on screen, or its last answer asks the manager)
 *   limit    faded orange          (waiting for the usage limit to reset)
 *   error    red                   (ended with an error)
 *   idle     no dot                (its turn is over, nothing asked)
 *   off      no dot, faded         (hibernated or done: not running)
 */
export type PresenceKind = 'working' | 'needs' | 'limit' | 'error' | 'idle' | 'off';

export interface Presence {
  kind: PresenceKind;
  label: string;
}

type Shown = Pick<Session, 'status' | 'attention' | 'limit' | 'permission'>;

/** asked: its last answer to the manager asks something (Needs you), from useNeedsIds */
export function presence(s: Shown, asked = false): Presence {
  if (s.status === 'working') return { kind: 'working', label: 'Working' };
  if (s.status === 'starting') return { kind: 'working', label: 'Starting' };
  if (s.status === 'error') return { kind: 'error', label: 'Error' };
  if (s.status === 'hibernated' || s.status === 'done') return { kind: 'off', label: STATUS_LABELS[s.status] };
  // waiting
  if (s.permission !== undefined || s.attention === true) return { kind: 'needs', label: 'Needs input' };
  if (s.limit) return { kind: 'limit', label: 'Usage limit' };
  if (asked) return { kind: 'needs', label: 'Needs you' };
  return { kind: 'idle', label: 'Idle' };
}
