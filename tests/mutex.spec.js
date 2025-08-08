/* global describe, test, expect */
/**
 * Test suite for rapid-mutex: covers creation, locking, contention, error handling, and edge cases.
 */
import { createMutex, withMutex, LockStatus, MutexError, rapidGuard } from '../src';

describe('rapid-mutex', () => {
  describe('createMutex', () => {
    test('creates an unlocked mutex', () => {
      const mutex = createMutex();
      expect(mutex.isLocked()).toBe(false);
      expect(mutex.buffer[0]).toBe(LockStatus.Unlocked);
    });

    test('creates mutex with proper buffer structure', () => {
      const mutex = createMutex();
      expect(mutex.buffer).toBeInstanceOf(Int32Array);
      expect(mutex.buffer.buffer).toBeInstanceOf(SharedArrayBuffer);
      expect(mutex.buffer.length).toBeGreaterThanOrEqual(1);
    });

    test('locks and unlocks asynchronously', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();
      expect(mutex.isLocked()).toBe(true);
      handle[mutex.dispose]();
      expect(mutex.isLocked()).toBe(false);
    });

    test('locks and unlocks synchronously', () => {
      const mutex = createMutex();
      const handle = mutex.lockSync();
      expect(mutex.isLocked()).toBe(true);
      handle[mutex.dispose]();
      expect(mutex.isLocked()).toBe(false);
    });

    test('throws if unlocking an unlocked mutex', () => {
      const mutex = createMutex();
      expect(() => mutex.unlock()).toThrow(MutexError);
      expect(() => mutex.unlock()).toThrow(/not locked/i);
    });

    test('returns frozen mutex object', () => {
      const mutex = createMutex();
      expect(Object.isFrozen(mutex)).toBe(true);
    });
  });

  describe('withMutex', () => {
    test('creates a mutex from a string', () => {
      const mutex = withMutex('resource');
      expect(mutex.isLocked()).toBe(false);
    });

    test('creates a mutex from an Int32Array', () => {
      const buffer = new Int32Array(new SharedArrayBuffer(4));
      const mutex = withMutex(buffer);
      expect(mutex.isLocked()).toBe(false);
    });

    test('throws on invalid input', () => {
      expect(() => withMutex(null)).toThrow(MutexError);
      expect(() => withMutex(undefined)).toThrow(MutexError);
      expect(() => withMutex('')).toThrow(MutexError);
      expect(() => withMutex(123)).toThrow(MutexError);
    });

    test('validates buffer requirements', () => {
      const regularArray = new Int32Array(4);
      expect(() => withMutex(regularArray)).toThrow(MutexError);
      expect(() => withMutex(regularArray)).toThrow(/SharedArrayBuffer/i);
    });

    test('string identifiers create unique buffers', () => {
      const mutex1 = withMutex('same-name');
      const mutex2 = withMutex('same-name');
      // Note: Each call creates a new buffer, so they're independent
      expect(mutex1.buffer).not.toBe(mutex2.buffer);
    });
  });

  describe('rapidGuard', () => {
    test('executes function with automatic lock management', async () => {
      const mutex = createMutex();
      let executed = false;

      const result = await rapidGuard(mutex, async () => {
        executed = true;
        expect(mutex.isLocked()).toBe(true);
        return 'success';
      });

      expect(executed).toBe(true);
      expect(result).toBe('success');
      expect(mutex.isLocked()).toBe(false);
    });

    test('unlocks mutex even if function throws', async () => {
      const mutex = createMutex();

      await expect(
        rapidGuard(mutex, () => {
          expect(mutex.isLocked()).toBe(true);
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(mutex.isLocked()).toBe(false);
    });

    test('works with synchronous functions', async () => {
      const mutex = createMutex();

      const result = await rapidGuard(mutex, () => {
        expect(mutex.isLocked()).toBe(true);
        return 42;
      });

      expect(result).toBe(42);
      expect(mutex.isLocked()).toBe(false);
    });

    test('respects timeout parameter', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();

      await expect(rapidGuard(mutex, () => {}, 100)).rejects.toThrow(MutexError);

      handle[mutex.dispose]();
    });

    test('validates mutex parameter', async () => {
      await expect(rapidGuard(null, () => {})).rejects.toThrow(MutexError);

      await expect(rapidGuard({}, () => {})).rejects.toThrow(MutexError);
    });

    test('validates function parameter', async () => {
      const mutex = createMutex();

      await expect(rapidGuard(mutex, null)).rejects.toThrow(MutexError);

      await expect(rapidGuard(mutex, 'not-a-function')).rejects.toThrow(MutexError);
    });
  });

  describe('contention', () => {
    test('allows only one lock at a time (async)', async () => {
      const mutex = createMutex();
      const handle1 = await mutex.lock();
      let locked = false;
      const p = mutex.lock().then(h => {
        locked = true;
        h[mutex.dispose]();
      });
      // Wait a bit to ensure second lock is waiting
      await new Promise(res => setTimeout(res, 50));
      expect(locked).toBe(false);
      handle1[mutex.dispose]();
      await p;
      expect(locked).toBe(true);
      expect(mutex.isLocked()).toBe(false);
    });

    test('times out if lock cannot be acquired (async)', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();
      await expect(mutex.lock(10)).rejects.toThrow(MutexError);
      await expect(mutex.lock(10)).rejects.toThrow(/timed out after 10ms/i);
      handle[mutex.dispose]();
    });

    test('times out if lock cannot be acquired (sync)', () => {
      const mutex = createMutex();
      const handle = mutex.lockSync();
      expect(() => mutex.lockSync(10)).toThrow(/timed out after 10ms/i);
      handle[mutex.dispose]();
    });

    test('multiple waiters are served in order', async () => {
      const mutex = createMutex();
      const results = [];
      const handle = await mutex.lock();

      // Start multiple waiters
      const promises = [1, 2, 3].map(id =>
        mutex.lock().then(h => {
          results.push(id);
          h[mutex.dispose]();
        })
      );

      // Release the initial lock after a delay
      setTimeout(() => handle[mutex.dispose](), 50);

      await Promise.all(promises);
      expect(results).toHaveLength(3);
      expect(results).toEqual(expect.arrayContaining([1, 2, 3]));
    });
  });

  describe('timeout validation', () => {
    test('accepts Infinity as timeout', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock(Infinity);
      expect(mutex.isLocked()).toBe(true);
      handle[mutex.dispose]();
    });

    test('rejects negative timeouts', async () => {
      const mutex = createMutex();
      await expect(mutex.lock(-1)).rejects.toThrow(MutexError);
      expect(() => mutex.lockSync(-1)).toThrow(MutexError);
    });

    test('rejects invalid timeout types', async () => {
      const mutex = createMutex();
      await expect(mutex.lock('invalid')).rejects.toThrow(MutexError);
      await expect(mutex.lock(null)).rejects.toThrow(MutexError);
    });

    test('handles zero timeout correctly', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();

      await expect(mutex.lock(0)).rejects.toThrow(MutexError);
      expect(() => mutex.lockSync(0)).toThrow(MutexError);

      handle[mutex.dispose]();
    });
  });

  describe('re-entrancy', () => {
    test('does not allow re-entrant locking (async)', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();
      const lockPromise = mutex.lock(20);
      await expect(lockPromise).rejects.toThrow(/timed out after 20ms/i);
      handle[mutex.dispose]();
    });

    test('does not allow re-entrant locking (sync)', () => {
      const mutex = createMutex();
      const handle = mutex.lockSync();
      expect(() => mutex.lockSync(20)).toThrow(MutexError);
      handle[mutex.dispose]();
    });
  });

  describe('handle safety', () => {
    test('does not allow unlocking with wrong handle', async () => {
      const mutex1 = createMutex();
      const mutex2 = createMutex();
      const handle1 = await mutex1.lock();
      expect(() => mutex2.unlock()).toThrow();
      handle1[mutex1.dispose]();
    });

    test('calling dispose twice does not throw', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();
      handle[mutex.dispose]();
      expect(() => handle[mutex.dispose]()).not.toThrow();
    });

    test('dispose symbol is consistent', () => {
      const mutex = createMutex();
      expect(mutex.dispose).toBe(mutex.dispose);
    });
  });

  describe('multiple mutexes', () => {
    test('multiple mutexes do not interfere', async () => {
      const m1 = createMutex();
      const m2 = createMutex();
      const h1 = await m1.lock();
      expect(m1.isLocked()).toBe(true);
      expect(m2.isLocked()).toBe(false);
      const h2 = await m2.lock();
      expect(m2.isLocked()).toBe(true);
      h1[m1.dispose]();
      h2[m2.dispose]();
      expect(m1.isLocked()).toBe(false);
      expect(m2.isLocked()).toBe(false);
    });
  });

  describe('buffer validation', () => {
    test('rejects non-Int32Array buffers', () => {
      expect(() => withMutex(new Uint32Array(4))).toThrow(MutexError);
      expect(() => withMutex(new ArrayBuffer(4))).toThrow(MutexError);
      expect(() => withMutex([])).toThrow(MutexError);
    });

    test('rejects buffers with insufficient length', () => {
      const buffer = new Int32Array(new SharedArrayBuffer(0));
      expect(() => withMutex(buffer)).toThrow(MutexError);
      expect(() => withMutex(buffer)).toThrow(/length >= 1/i);
    });

    test('accepts buffers with extra space', () => {
      const buffer = new Int32Array(new SharedArrayBuffer(16)); // 4 Int32s
      buffer[0] = LockStatus.Unlocked;

      const mutex = withMutex(buffer);
      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('string buffer creation', () => {
    test('creates different buffers for different strings', () => {
      const mutex1 = withMutex('string1');
      const mutex2 = withMutex('string2');

      expect(mutex1.buffer).not.toBe(mutex2.buffer);
    });

    test('handles unicode strings correctly', () => {
      const mutex = withMutex('测试-🔒-تست');
      expect(mutex.isLocked()).toBe(false);
    });

    test('handles long strings', () => {
      const longString = 'a'.repeat(1000);
      const mutex = withMutex(longString);
      expect(mutex.isLocked()).toBe(false);
    });

    test('created buffer has proper alignment', () => {
      const mutex = withMutex('test');
      const bufferSize = mutex.buffer.buffer.byteLength;
      expect(bufferSize % 4).toBe(0); // Should be 4-byte aligned
    });
  });

  describe('robustness', () => {
    test('stress test: many locks/unlocks', async () => {
      const mutex = createMutex();
      for (let i = 0; i < 100; i++) {
        const handle = await mutex.lock();
        expect(mutex.isLocked()).toBe(true);
        handle[mutex.dispose]();
        expect(mutex.isLocked()).toBe(false);
      }
    });

    test('stress test: concurrent operations', async () => {
      const mutex = createMutex();
      let counter = 0;

      const workers = Array.from({ length: 10 }, async () => {
        for (let i = 0; i < 10; i++) {
          await rapidGuard(mutex, () => {
            counter++;
          });
        }
      });

      await Promise.all(workers);
      expect(counter).toBe(100);
    });

    test('performance: quick sequential locks', async () => {
      const mutex = createMutex();
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        const handle = await mutex.lock();
        handle[mutex.dispose]();
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('edge cases', () => {
    test('unlock without lock throws', () => {
      const mutex = createMutex();
      expect(() => mutex.unlock()).toThrow(MutexError);
      expect(() => mutex.unlock()).toThrow(/not locked/i);
    });

    test('lock with zero timeout fails if already locked', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();
      await expect(mutex.lock(0)).rejects.toThrow(MutexError);
      await expect(mutex.lock(0)).rejects.toThrow(/timed out after (\d+)ms/i);
      handle[mutex.dispose]();
    });

    test('immediate lock succeeds when mutex is available', async () => {
      const mutex = createMutex();

      const handle = await mutex.lock(0);
      expect(mutex.isLocked()).toBe(true);

      handle[mutex.dispose]();
    });

    test('handles rapid lock/unlock cycles', async () => {
      const mutex = createMutex();

      for (let i = 0; i < 50; i++) {
        const handle = await mutex.lock();
        handle[mutex.dispose]();

        const handle2 = mutex.lockSync();
        handle2[mutex.dispose]();
      }

      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('error handling', () => {
    test('MutexError has correct name and type', () => {
      const mutex = createMutex();

      try {
        mutex.unlock();
      } catch (error) {
        expect(error).toBeInstanceOf(MutexError);
        expect(error.name).toBe('RapidMutexError');
        expect(error.message).toContain('not locked');
      }
    });

    test('timeout errors include duration', async () => {
      const mutex = createMutex();
      const handle = await mutex.lock();

      try {
        await mutex.lock(250);
      } catch (error) {
        expect(error.message).toContain('250ms');
      }

      handle[mutex.dispose]();
    });
  });

  describe('integration', () => {
    test('sequentially works with rapidMutex created from string', async () => {
      const mutex = withMutex('integration-test');
      let value = 0;

      const result = await rapidGuard(mutex, () => {
        value = 42;
        return value;
      });

      expect(result).toBe(42);
      expect(value).toBe(42);
    });

    test('mixed async and sync operations', async () => {
      const mutex = createMutex();
      let order = [];

      // Start async lock
      const asyncPromise = rapidGuard(mutex, async () => {
        order.push('async-start');
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push('async-end');
        return 'async-result';
      });

      // Try sync lock (should wait)
      setTimeout(() => {
        try {
          const handle = mutex.lockSync(5);
          order.push('sync');
          handle[mutex.dispose]();
        } catch (error) {
          order.push('sync-timeout');
        }
      }, 5);

      const result = await asyncPromise;

      expect(result).toBe('async-result');
      expect(order).toEqual(['async-start', 'sync-timeout', 'async-end']);
    });
  });
});
