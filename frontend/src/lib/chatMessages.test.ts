import { expect, it } from 'vitest';
import { mergeChatMessages } from './chatMessages';

it('isolates rooms and deduplicates the same REST and WebSocket message', () => {
  const own = { id:'a', alumno_id:'room-a', created_date:'2026-01-01T00:00:00Z', contenido:'first' };
  const other = { ...own, id:'b', alumno_id:'room-b' };
  expect(mergeChatMessages([own], [own, other], 'room-a')).toEqual([own]);
});
it('uses the stable backend ordering for simultaneous messages', () => {
  const first = { id:'a', alumno_id:'room', created_date:'2026-01-01T00:00:00Z' };
  const second = { ...first,id:'b' };
  expect(mergeChatMessages([second], [first], 'room')).toEqual([first, second]);
});
