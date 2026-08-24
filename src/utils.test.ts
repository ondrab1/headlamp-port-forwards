import { describe, expect, it, vi } from 'vitest';

// utils reaches into the Headlamp API for its cluster helpers; describeError
// needs none of it, and the real module drags in the whole plugin library.
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ K8s: { ResourceClasses: {} } }));

import { describeError } from './utils';

describe('describeError', () => {
  it('appends the status the cluster proxy hid behind "Unreachable"', () => {
    const err = Object.assign(new Error('Unreachable'), { status: 404 });

    expect(describeError(err)).toBe('Unreachable (HTTP 404)');
  });

  it('leaves an error without a status alone', () => {
    expect(describeError(new Error('Could not resolve a pod for redis'))).toBe(
      'Could not resolve a pod for redis'
    );
  });

  it('does not append a zero status', () => {
    expect(describeError(Object.assign(new Error('boom'), { status: 0 }))).toBe('boom');
  });

  it('stringifies whatever is not an error', () => {
    expect(describeError('plain string')).toBe('plain string');
    expect(describeError(undefined)).toBe('undefined');
  });
});
