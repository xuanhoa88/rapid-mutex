/**
 * Custom error for mutex operations.
 * Used to differentiate mutex-specific errors from general errors.
 */
export class MutexError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RapidMutexError';
  }
}

/**
 * Constants representing lock states.
 * @readonly
 * @enum {number}
 */
export const LockStatus = Object.freeze({
  Unlocked: 0,
  Locked: 1,
});

/**
 * Symbol used for disposing a lock resource.
 * Falls back to a safe polyfill for Node.js < 20.
 * @type {symbol}
 */
export const dispose =
  typeof Symbol.dispose === 'symbol' ? Symbol.dispose : Symbol.for('rapid-mutex-dispose');

/**
 * Cross-environment async wait function for `Atomics.waitAsync`.
 * Uses native if available (Node >= 16.10, modern browsers).
 * Polyfills via tight loop and Atomics.wait if not available.
 *
 * @param {Int32Array} buffer Shared lock buffer.
 * @param {number} index Index in buffer to monitor.
 * @param {number} value Expected value to wait on.
 * @param {number} timeoutMs Timeout in milliseconds or Infinity.
 * @returns {Promise<string>} Resolves with 'ok', 'not-equal', or 'timed-out'.
 */
const waitAsync = Atomics.waitAsync
  ? (buffer, index, value, timeoutMs) => Atomics.waitAsync(buffer, index, value, timeoutMs).value
  : (buffer, index, value, timeoutMs) => {
      return new Promise(resolve => {
        const deadline = timeoutMs === Infinity ? Infinity : Date.now() + timeoutMs;

        const loop = () => {
          const now = Date.now();
          if (now >= deadline) {
            return resolve('timed-out');
          }

          // Wait for up to 1ms to avoid blocking indefinitely
          const res = Atomics.wait(buffer, index, value, 1);
          if (res === 'ok' || res === 'not-equal') {
            return resolve(res);
          }

          // Use setTimeout as fallback if setImmediate is not available
          if (typeof setImmediate !== 'undefined') {
            setImmediate(loop);
          } else {
            setTimeout(loop, 0);
          }
        };

        loop();
      });
    };

/**
 * Validates that a given buffer is a valid mutex storage.
 * @param {any} buffer Buffer to validate.
 * @throws {MutexError} If buffer is invalid.
 */
const validateMutexBuffer = buffer => {
  if (!(buffer instanceof Int32Array)) {
    throw new MutexError('Invalid buffer: must be an Int32Array');
  }
  if (buffer.length < 1) {
    throw new MutexError('Invalid buffer: must have length >= 1');
  }
  if (!(buffer.buffer instanceof SharedArrayBuffer)) {
    throw new MutexError('Invalid buffer: must be backed by a SharedArrayBuffer');
  }
};

/**
 * Validates timeout parameter.
 * @param {number} timeoutMs Timeout value to validate.
 * @throws {MutexError} If timeout is invalid.
 */
const validateTimeout = timeoutMs => {
  if (timeoutMs !== Infinity && (typeof timeoutMs !== 'number' || timeoutMs < 0)) {
    throw new MutexError('Timeout must be a non-negative number or Infinity');
  }
};

/**
 * Acquires the lock asynchronously.
 *
 * @param {Int32Array} buffer Lock buffer.
 * @param {number} [timeoutMs=Infinity] Timeout in milliseconds.
 * @returns {Promise<{[dispose]: Function}>} Disposable lock handle.
 * @throws {MutexError} If lock acquisition times out or is interrupted.
 */
const lock = async (buffer, timeoutMs = Infinity) => {
  validateMutexBuffer(buffer);
  validateTimeout(timeoutMs);

  const start = Date.now();

  // Immediate try-lock
  if (
    Atomics.compareExchange(buffer, 0, LockStatus.Unlocked, LockStatus.Locked) ===
    LockStatus.Unlocked
  ) {
    return { [dispose]: () => unlock(buffer, true) };
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const elapsed = Date.now() - start;
    if (timeoutMs !== Infinity && elapsed > timeoutMs) {
      throw new MutexError(`Mutex lock acquisition timed out after ${timeoutMs}ms`);
    }

    if (
      Atomics.compareExchange(buffer, 0, LockStatus.Unlocked, LockStatus.Locked) ===
      LockStatus.Unlocked
    ) {
      return { [dispose]: () => unlock(buffer, true) };
    }

    const remainingTime = timeoutMs === Infinity ? Infinity : Math.max(0, timeoutMs - elapsed);
    const waitResult = await waitAsync(buffer, 0, LockStatus.Locked, remainingTime);

    if (waitResult === 'timed-out') {
      throw new MutexError(`Mutex lock acquisition timed out after ${timeoutMs}ms`);
    }
    if (waitResult === 'interrupted') {
      throw new MutexError('Mutex wait was interrupted');
    }
  }
};

/**
 * Acquires the lock synchronously (blocking).
 *
 * @param {Int32Array} buffer Lock buffer.
 * @param {number} [timeoutMs=Infinity] Timeout in milliseconds.
 * @returns {{[dispose]: Function}} Disposable lock handle.
 * @throws {MutexError} If lock acquisition times out or is interrupted.
 */
const lockSync = (buffer, timeoutMs = Infinity) => {
  validateMutexBuffer(buffer);
  validateTimeout(timeoutMs);

  const start = Date.now();

  if (
    Atomics.compareExchange(buffer, 0, LockStatus.Unlocked, LockStatus.Locked) ===
    LockStatus.Unlocked
  ) {
    return { [dispose]: () => unlock(buffer, true) };
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const elapsed = Date.now() - start;
    if (timeoutMs !== Infinity && elapsed > timeoutMs) {
      throw new MutexError(`Mutex lock acquisition timed out after ${timeoutMs}ms`);
    }

    if (
      Atomics.compareExchange(buffer, 0, LockStatus.Unlocked, LockStatus.Locked) ===
      LockStatus.Unlocked
    ) {
      return { [dispose]: () => unlock(buffer, true) };
    }

    const remainingTime = timeoutMs === Infinity ? Infinity : Math.max(0, timeoutMs - elapsed);
    const waitResult = Atomics.wait(buffer, 0, LockStatus.Locked, remainingTime);

    if (waitResult === 'timed-out') {
      throw new MutexError(`Mutex lock acquisition timed out after ${timeoutMs}ms`);
    }
    if (waitResult === 'interrupted') {
      throw new MutexError('Mutex wait was interrupted');
    }
  }
};

/**
 * Releases a previously acquired lock.
 *
 * @param {Int32Array} buffer Lock buffer.
 * @param {boolean} [fromDispose=false] True if called from dispose symbol.
 * @throws {MutexError} If the mutex is not locked.
 */
const unlock = (buffer, fromDispose = false) => {
  validateMutexBuffer(buffer);
  const currentState = Atomics.compareExchange(buffer, 0, LockStatus.Locked, LockStatus.Unlocked);
  if (currentState !== LockStatus.Locked) {
    if (fromDispose) return;
    throw new MutexError('Cannot unlock mutex that is not locked');
  }
  Atomics.notify(buffer, 0);
};

/**
 * Creates a mutex buffer initialized from a string identifier.
 * Useful for cross-worker named locks.
 *
 * @param {string} input Identifier string.
 * @returns {Int32Array} Mutex buffer.
 * @throws {MutexError} If input is invalid.
 */
const createBufferFromString = input => {
  if (!input || typeof input !== 'string') {
    throw new MutexError('Invalid input: must be a non-empty string');
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);

  // Ensure proper 4-byte alignment
  const headerSize = 4; // Size of Int32 lock state
  const totalSize = headerSize + bytes.byteLength;
  const alignedSize = Math.ceil(totalSize / 4) * 4;

  const buffer = new SharedArrayBuffer(alignedSize);
  const int32View = new Int32Array(buffer);
  const uint8View = new Uint8Array(buffer);

  // Initialize lock state
  int32View[0] = LockStatus.Unlocked;

  // Copy string bytes after the lock state
  uint8View.set(bytes, headerSize);

  // Zero-fill any padding bytes
  if (alignedSize > totalSize) {
    uint8View.fill(0, totalSize, alignedSize);
  }

  return int32View;
};

/**
 * Creates a mutex (mutual exclusion) lock using SharedArrayBuffer and Atomics.
 * This allows safe synchronization between threads or workers in JavaScript.
 *
 * @returns {Readonly<{
 *   buffer: Int32Array,
 *   dispose: symbol,
 *   lock: (timeoutMs?: number) => Promise<{[dispose]: Function}>,
 *   lockSync: (timeoutMs?: number) => {[dispose]: Function},
 *   unlock: () => void,
 *   isLocked: () => boolean
 * }>} A frozen mutex object with lock/unlock methods.
 *
 * @example
 * // Basic usage with try-finally
 * const mutex = createMutex();
 *
 * const lockHandle = await mutex.lock();
 * try {
 *   // critical section
 *   sharedCounter++;
 * } finally {
 *   lockHandle[dispose]();
 * }
 *
 * @example
 * // Using with timeout
 * const mutex = createMutex();
 * try {
 *   const lockHandle = await mutex.lock(1000); // 1 second timeout
 *   try {
 *     console.log('Lock acquired within 1 second');
 *     // critical section
 *   } finally {
 *     lockHandle[dispose]();
 *   }
 * } catch (error) {
 *   if (error instanceof MutexError) {
 *     console.log('Failed to acquire lock within timeout');
 *   }
 * }
 *
 * @example
 * // Using with rapidGuard helper
 * const mutex = createMutex();
 * const result = await rapidGuard(mutex, async () => {
 *   // critical section
 *   return doSomeWork();
 * }, 1000);
 */
export const createMutex = () => {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  buffer[0] = LockStatus.Unlocked;

  return Object.freeze({
    buffer,
    dispose,
    lock: timeoutMs => lock(buffer, timeoutMs),
    lockSync: timeoutMs => lockSync(buffer, timeoutMs),
    unlock: () => unlock(buffer),
    isLocked: () => Atomics.load(buffer, 0) === LockStatus.Locked,
  });
};

/**
 * Creates a mutex from either a string identifier or existing buffer.
 * When using string identifiers, creates a new SharedArrayBuffer each time.
 * For true cross-worker synchronization, you need to share the actual buffer.
 *
 * @param {string|Int32Array} input - String identifier or existing Int32Array buffer.
 * @returns {Readonly<{
 *   buffer: Int32Array,
 *   dispose: symbol,
 *   lock: (timeoutMs?: number) => Promise<{[dispose]: Function}>,
 *   lockSync: (timeoutMs?: number) => {[dispose]: Function},
 *   unlock: () => void,
 *   isLocked: () => boolean
 * }>} A frozen mutex object.
 * @throws {MutexError} If input is invalid.
 *
 * @example
 * // Using with an existing buffer from createMutex
 * const mutexA = createMutex();
 * const lockHandle = await mutexA.lock();
 * lockHandle[dispose]();
 *
 * const sameMutex = withMutex(mutexA.buffer);
 * console.log(sameMutex.isLocked()); // false
 *
 * @example
 * // Using with a string identifier (creates new buffer each time)
 * const mutexB = withMutex('shared-task');
 * try {
 *   const lockHandle = await mutexB.lock(1000);
 *   try {
 *     // Critical section
 *   } finally {
 *     lockHandle[dispose]();
 *   }
 * } catch (error) {
 *   console.log('Lock acquisition failed:', error.message);
 * }
 */
export const withMutex = input => {
  if (input === undefined || input === null) {
    throw new MutexError('Invalid input: must provide a string or Int32Array');
  }

  const buffer = typeof input === 'string' ? createBufferFromString(input) : input;
  validateMutexBuffer(buffer);

  return Object.freeze({
    buffer,
    dispose,
    lock: timeoutMs => lock(buffer, timeoutMs),
    lockSync: timeoutMs => lockSync(buffer, timeoutMs),
    unlock: () => unlock(buffer),
    isLocked: () => Atomics.load(buffer, 0) === LockStatus.Locked,
  });
};

/**
 * Runs a function with exclusive access using a mutex.
 * Ensures the mutex is always unlocked, even if the function throws.
 *
 * @template T
 * @param {ReturnType<typeof createMutex>} mutex - The mutex object.
 * @param {() => Promise<T>|T} fn - Function to run within the locked section.
 * @param {number} [timeoutMs=Infinity] - Optional timeout for acquiring the lock.
 * @returns {Promise<T>} The result of the function.
 * @throws {MutexError} If lock acquisition fails or times out.
 *
 * @example
 * const mutex = createMutex();
 * let sharedCounter = 0;
 *
 * const result = await rapidGuard(mutex, async () => {
 *   sharedCounter++;
 *   await someAsyncWork();
 *   return sharedCounter;
 * }, 5000); // 5 second timeout
 *
 * @example
 * // Using with synchronous function
 * const syncResult = await rapidGuard(mutex, () => {
 *   return performSyncOperation();
 * });
 */
export const rapidGuard = async (mutex, fn, timeoutMs = Infinity) => {
  if (!mutex || typeof mutex.lock !== 'function') {
    throw new MutexError('Invalid mutex: must be a mutex object with lock method');
  }
  if (typeof fn !== 'function') {
    throw new MutexError('Invalid function: must provide a function to execute');
  }

  const lockHandle = await mutex.lock(timeoutMs);
  try {
    return await fn();
  } finally {
    lockHandle[dispose]();
  }
};
