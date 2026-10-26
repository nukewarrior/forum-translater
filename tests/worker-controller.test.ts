import { expect, it, vi } from 'vitest';
import { TranslationWorkerController } from '../src/translation/worker-controller';
import { DEFAULTS } from '../src/settings';

it('yields between owners, uses their latest paint and cancels removed owners', async () => {
  vi.useFakeTimers();
  const worker = new TranslationWorkerController(DEFAULTS.ai);
  const first = vi.fn(); const old = vi.fn(); const latest = vi.fn(); const removed = vi.fn();
  try {
    worker.render('first', first); worker.render('second', old); worker.render('removed', removed);
    await vi.advanceTimersByTimeAsync(80);
    expect(first).toHaveBeenCalledOnce(); expect(old).not.toHaveBeenCalled();
    worker.render('second', latest); worker.release('removed');
    await vi.advanceTimersByTimeAsync(16);
    expect(latest).toHaveBeenCalledOnce(); expect(old).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(removed).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
    worker.render('destroyed', removed); worker.destroy();
    await vi.advanceTimersByTimeAsync(200); expect(removed).not.toHaveBeenCalled();
  } finally { worker.destroy(); vi.useRealTimers(); }
});

it('starts six visible requests concurrently while keeping further work queued', async () => {
  const worker = new TranslationWorkerController(DEFAULTS.ai); const finish: (() => void)[] = [];
  const pending = Array.from({ length: 7 }, (_, i) => worker.tasks.request({ key: String(i), serviceKey: 'test', priority: 'visible-batch', signal: new AbortController().signal }, () => new Promise<void>(resolve => { finish.push(resolve); })));
  await Promise.resolve(); expect(worker.tasks.snapshot()).toEqual({ active: 6, queued: 1 });
  finish[0]?.(); await pending[0]; await Promise.resolve();
  expect(finish).toHaveLength(7); finish.forEach(resolve => resolve()); await Promise.all(pending); worker.destroy();
});

it('prioritizes visible batches above interactive work and coalesces paints by owner', async () => {
  const worker = new TranslationWorkerController(DEFAULTS.ai);
  const order: string[] = [];
  try {
    const tasks = ['interactive', 'prefetch', 'visible-batch'].map(priority => worker.tasks.request({ key: priority, serviceKey: 'test', priority: priority as 'interactive' | 'prefetch' | 'visible-batch', signal: new AbortController().signal }, () => { order.push(priority); return Promise.resolve(); }));
    await Promise.all(tasks); expect(order[0]).toBe('visible-batch');
    vi.useFakeTimers(); const old = vi.fn(); const latest = vi.fn(); const removed = vi.fn();
    worker.render('post', old); worker.render('post', latest); worker.render('removed', removed); worker.release('removed');
    await vi.advanceTimersByTimeAsync(80);
    expect(old).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
    expect(worker.format('Hello ⟦0⟧', '你好 ⟦0⟧')).toBe('你好 ⟦0⟧');
    expect(() => worker.format('Hello ⟦0⟧', '你好')).toThrow();
  } finally { worker.destroy(); vi.useRealTimers(); }
});
