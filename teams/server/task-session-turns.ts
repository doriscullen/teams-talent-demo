import type { RequirementNode } from '../src/delivery-requirements.js';
import type { TaskSessionMessage, TaskSessionStatus, TaskSessionTurn } from '../src/task-session-stream.js';
type Json = Record<string, any>;
const time = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const identity = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 300 ? value : undefined;
interface NativeTurn { id: string; aliases: string[]; round: number | null; at: string; end?: string; failed: boolean; opening?: string; user?: Json; replies: Json[] }

/** Project only native user/assistant text. Metadata, Hook reminders, system prompts,
 * reasoning, tool arguments and outputs never enter this presentation contract. */
export function projectSessionTurns(input: {
  document: Json | null; rows: Json[]; sessionId: string; runId: string; nodeId: RequirementNode;
  status: TaskSessionStatus; nodeAt(at: string): RequirementNode; points: Array<{ at: string }>;
  clean(text: string): string;
}): TaskSessionTurn[] {
  const turns: NativeTurn[] = [], aliases = new Map<string, NativeTurn>();
  for (const row of input.rows) {
    if (row.event_type !== 'turn.started') continue;
    const payload = row.payload ?? {}, id = identity(payload.logical_turn_id) ?? identity(row.turn_id), at = time(row.occurred_at);
    if (!id || !at) continue;
    let turn = aliases.get(id);
    if (!turn) { turn = { id, aliases: [], round: Number.isSafeInteger(payload.turn_number) && payload.turn_number > 0 ? payload.turn_number : null, at, failed: false, opening: identity(payload.opening_item_id), replies: [] }; turns.push(turn); aliases.set(id, turn); }
    if (identity(row.turn_id)) { aliases.set(row.turn_id, turn); turn.aliases.push(row.turn_id); }
  }
  for (const row of input.rows) {
    if (!['turn.finished', 'turn.response_settled'].includes(row.event_type)) continue;
    const turn = aliases.get(row.turn_id), at = time(row.occurred_at); if (!turn || !at) continue;
    turn.end = at;
    if (typeof row.payload?.outcome === 'string') turn.failed = ['failed', 'error', 'cancelled'].includes(row.payload.outcome);
  }
  const messageId = (message: Json) => identity(message.message_id) ?? identity(message.additional_properties?._chrys_analytics_item_id) ?? identity(message.additional_properties?._group?.id);
  const messageTime = (message: Json) => time(message.additional_properties?._chrys_created_at);
  const messages = (input.document?.state.messages ?? []).filter((message: Json) => ['user', 'assistant'].includes(message.role) && Array.isArray(message.contents) && messageId(message) && messageTime(message));
  // A real user message is itself an observed turn boundary when older recordings
  // have no turn event. It does not derive a round from model/tool cycles.
  for (const message of messages.filter((message: Json) => message.role === 'user')) {
    const id = messageId(message)!, at = messageTime(message)!;
    let turn = turns.find(turn => turn.opening === id || turn.opening === message.additional_properties?._chrys_analytics_item_id);
    if (!turn) {
      turn = turns.find(turn => !turn.user && !turn.opening && Date.parse(turn.at) >= Date.parse(at) && !messages.some((other: Json) => other.role === 'user' && Date.parse(messageTime(other)!) > Date.parse(at) && Date.parse(messageTime(other)!) <= Date.parse(turn.at)));
      if (!turn) { turn = { id: 'message:' + id, aliases: [], round: null, at, failed: false, opening: id, replies: [] }; turns.push(turn); }
    }
    turn.user = message;
  }
  turns.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const message of messages.filter((message: Json) => message.role === 'assistant')) {
    const at = messageTime(message)!;
    const turn = turns.filter(turn => Date.parse(turn.user ? messageTime(turn.user)! : turn.at) <= Date.parse(at) && (!turn.end || Date.parse(at) <= Date.parse(turn.end))).at(-1);
    if (turn) turn.replies.push(message);
  }
  const visible = (message: Json): TaskSessionMessage | null => {
    const text = input.clean(message.contents.filter((part: Json) => part.type === 'text' && typeof part.text === 'string').map((part: Json) => part.text).join('\n'));
    return text.trim() ? { id: messageId(message)!, at: messageTime(message)!, text } : null;
  };
  return turns.flatMap((turn, index) => {
    const start = turn.user ? messageTime(turn.user)! : turn.at;
    const end = turn.end ?? turns[index + 1]?.at ?? (input.status === 'running' ? new Date().toISOString() : turn.replies.at(-1) ? messageTime(turn.replies.at(-1)!)! : turn.at);
    const points = [start, ...input.points.filter(point => Date.parse(point.at) >= Date.parse(start) && Date.parse(point.at) <= Date.parse(end)).map(point => point.at)];
    const userSourceNode = turn.user ? input.nodeAt(messageTime(turn.user)!) : undefined;
    const replies = new Map<string, TaskSessionMessage>();
    for (const message of turn.replies) if (input.nodeAt(messageTime(message)!) === input.nodeId) { const text = visible(message); if (text) replies.set(text.id, text); }
    const user = turn.user && userSourceNode === input.nodeId ? visible(turn.user) : null;
    if (!points.some(at => input.nodeAt(at) === input.nodeId) && !user && !replies.size) return [];
    const status = turn.failed ? 'failed' : turn.end || turns[index + 1] || input.status === 'completed' ? 'ended' : input.status === 'failed' ? 'failed' : input.status === 'running' ? 'running' : 'unknown';
    const updatedAt = [start, turn.end, ...[...replies.values()].map(message => message.at)].filter((value): value is string => !!value).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!;
    return [{ id: `${input.runId}:turn:${turn.id}:${input.nodeId}`, sessionId: input.sessionId, runId: input.runId, nodeId: input.nodeId, turnId: turn.id, round: turn.round, startedAt: start, updatedAt, status, user, replies: [...replies.values()], ...(userSourceNode ? { userSourceNode } : {}), ...(!turn.user ? { note: '原记录未提供本轮完整用户输入。' } : !user ? { note: userSourceNode !== input.nodeId ? '本轮用户输入发生在其他节点；此处仅展示当前节点的回复。' : '原记录未提供可显示的用户正文。' } : {}) } satisfies TaskSessionTurn];
  });
}
