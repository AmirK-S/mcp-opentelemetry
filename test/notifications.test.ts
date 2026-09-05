/**
 * Extended scope (BRIEF 5.2.1): notifications are not instrumented in the
 * minimal release. These tests describe the intended behavior and stay
 * pending until that step.
 */
import { describe, it } from 'vitest';

describe('notifications/progress', () => {
  it.todo('carries the traceparent of the server span that emits it');
  it.todo('produces a PRODUCER span on the emitter named notifications/progress');
});

describe('notifications/cancelled', () => {
  it.todo('carries the traceparent of the client span of the cancelled request');
  it.todo('links the PRODUCER span to the cancelled request span');
});
