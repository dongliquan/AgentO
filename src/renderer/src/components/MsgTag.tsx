import { kindSlug, type MsgKind } from '@/lib/msgKind';

const TITLE: Record<MsgKind, string> = {
  order: "The manager's order",
  direct: 'Typed into the session by the manager',
  task: 'Work handed to this session by another',
  ask: 'A question or a decision to make',
  report: 'A result reported back',
  finished: 'AgentO: the session finished the task it was sent',
  'handed on': 'The coordinator handed the work on — no result yet',
  note: 'A message between sessions'
};

/** One word in front of a team message saying what it is (order · task · ask · report · finished · handed on). */
export function MsgTag({ kind, taskId, className = '' }: { kind: MsgKind; taskId?: string; className?: string }): JSX.Element {
  return (
    <>
      <span className={`msg-tag k-${kindSlug(kind)} ${className}`} title={TITLE[kind]}>
        {kind}
      </span>
      {taskId && <span className="task-id" title="The piece of work (numbered by AgentO when it was sent)">{taskId}</span>}
    </>
  );
}
