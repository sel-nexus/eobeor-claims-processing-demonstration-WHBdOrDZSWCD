import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  vi,
} from 'vitest';

export const FIXED_TEST_TIME =
  '2024-01-22T12:00:00.000Z';

const NETWORK_ERROR_MESSAGE =
  'Unexpected network access in a browser-local unit test. Mock the application gateway instead.';

let cryptoSequence = 0;

const originalDescriptors = {
  crypto: Object.getOwnPropertyDescriptor(globalThis, 'crypto'),
  EventSource: Object.getOwnPropertyDescriptor(
    globalThis,
    'EventSource',
  ),
  fetch: Object.getOwnPropertyDescriptor(globalThis, 'fetch'),
  Worker: Object.getOwnPropertyDescriptor(globalThis, 'Worker'),
  WebSocket: Object.getOwnPropertyDescriptor(
    globalThis,
    'WebSocket',
  ),
  XMLHttpRequest: Object.getOwnPropertyDescriptor(
    globalThis,
    'XMLHttpRequest',
  ),
  createObjectURL: Object.getOwnPropertyDescriptor(
    globalThis.URL,
    'createObjectURL',
  ),
  revokeObjectURL: Object.getOwnPropertyDescriptor(
    globalThis.URL,
    'revokeObjectURL',
  ),
  sendBeacon:
    typeof globalThis.navigator === 'object'
      ? Object.getOwnPropertyDescriptor(
          globalThis.navigator,
          'sendBeacon',
        )
      : undefined,
  showModal:
    typeof globalThis.HTMLDialogElement === 'function'
      ? Object.getOwnPropertyDescriptor(
          globalThis.HTMLDialogElement.prototype,
          'showModal',
        )
      : undefined,
  close:
    typeof globalThis.HTMLDialogElement === 'function'
      ? Object.getOwnPropertyDescriptor(
          globalThis.HTMLDialogElement.prototype,
          'close',
        )
      : undefined,
};

export const networkPrimitiveSpies = {
  fetch: null,
  sendBeacon: null,
  XMLHttpRequest: null,
  WebSocket: null,
  EventSource: null,
};

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreProperty(target, name, descriptor) {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, name);
    return;
  }

  Object.defineProperty(target, name, descriptor);
}

function clearBrowserStorage() {
  try {
    globalThis['localStorage']?.clear();
  } catch {
    // Storage-denied behavior is tested through an injected gateway.
  }

  try {
    globalThis['sessionStorage']?.clear();
  } catch {
    // Storage-denied behavior is tested through an injected gateway.
  }
}

function createDeterministicUuid() {
  cryptoSequence += 1;

  return `00000000-0000-4000-8000-${cryptoSequence
    .toString(16)
    .padStart(12, '0')}`;
}

function fillDeterministicRandomValues(array) {
  if (
    array === null ||
    typeof array !== 'object' ||
    typeof array.length !== 'number'
  ) {
    throw new TypeError(
      'Expected an integer typed array for getRandomValues().',
    );
  }

  cryptoSequence += 1;

  for (let index = 0; index < array.length; index += 1) {
    array[index] = (cryptoSequence + index * 31) & 0xff;
  }

  return array;
}

function installDeterministicCrypto() {
  const currentCrypto = originalDescriptors.crypto?.value;

  defineGlobal('crypto', {
    ...(currentCrypto?.subtle === undefined
      ? {}
      : { subtle: currentCrypto.subtle }),
    getRandomValues: vi.fn(fillDeterministicRandomValues),
    randomUUID: vi.fn(createDeterministicUuid),
  });
}

function createFailFastConstructor(name) {
  return vi.fn(function failFastNetworkConstructor() {
    throw new Error(`${NETWORK_ERROR_MESSAGE} Primitive: ${name}.`);
  });
}

function installNetworkGuards() {
  networkPrimitiveSpies.fetch = vi.fn(() => {
    throw new Error(`${NETWORK_ERROR_MESSAGE} Primitive: fetch.`);
  });
  networkPrimitiveSpies.sendBeacon = vi.fn(() => {
    throw new Error(
      `${NETWORK_ERROR_MESSAGE} Primitive: sendBeacon.`,
    );
  });
  networkPrimitiveSpies.XMLHttpRequest =
    createFailFastConstructor('XMLHttpRequest');
  networkPrimitiveSpies.WebSocket =
    createFailFastConstructor('WebSocket');
  networkPrimitiveSpies.EventSource =
    createFailFastConstructor('EventSource');

  Object.assign(networkPrimitiveSpies.XMLHttpRequest, {
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4,
  });

  Object.assign(networkPrimitiveSpies.WebSocket, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });

  defineGlobal('fetch', networkPrimitiveSpies.fetch);
  defineGlobal(
    'XMLHttpRequest',
    networkPrimitiveSpies.XMLHttpRequest,
  );
  defineGlobal('WebSocket', networkPrimitiveSpies.WebSocket);
  defineGlobal('EventSource', networkPrimitiveSpies.EventSource);

  if (typeof globalThis.navigator === 'object') {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: networkPrimitiveSpies.sendBeacon,
    });
  }
}

class MockWorker {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.listeners = new Map();
    this.terminated = false;
    this.postMessage = vi.fn();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();

    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    if (this.terminated) {
      return false;
    }

    const propertyHandler = this[`on${event.type}`];

    if (typeof propertyHandler === 'function') {
      propertyHandler.call(this, event);
    }

    this.listeners.get(event.type)?.forEach((listener) => {
      listener.call(this, event);
    });

    return true;
  }

  terminate() {
    this.terminated = true;
    this.listeners.clear();
  }
}

function installBrowserApiMocks() {
  defineGlobal('Worker', MockWorker);

  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:test-object-url'),
  });

  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  if (typeof globalThis.HTMLDialogElement === 'function') {
    Object.defineProperty(
      globalThis.HTMLDialogElement.prototype,
      'showModal',
      {
        configurable: true,
        writable: true,
        value: vi.fn(function showModal() {
          this.setAttribute('open', '');
        }),
      },
    );

    Object.defineProperty(
      globalThis.HTMLDialogElement.prototype,
      'close',
      {
        configurable: true,
        writable: true,
        value: vi.fn(function close(returnValue = '') {
          this.returnValue = String(returnValue);
          this.removeAttribute('open');
          this.dispatchEvent(new Event('close'));
        }),
      },
    );
  }
}

function restoreRuntime() {
  restoreProperty(
    globalThis,
    'crypto',
    originalDescriptors.crypto,
  );
  restoreProperty(globalThis, 'fetch', originalDescriptors.fetch);
  restoreProperty(
    globalThis,
    'XMLHttpRequest',
    originalDescriptors.XMLHttpRequest,
  );
  restoreProperty(
    globalThis,
    'WebSocket',
    originalDescriptors.WebSocket,
  );
  restoreProperty(
    globalThis,
    'EventSource',
    originalDescriptors.EventSource,
  );
  restoreProperty(globalThis, 'Worker', originalDescriptors.Worker);
  restoreProperty(
    globalThis.URL,
    'createObjectURL',
    originalDescriptors.createObjectURL,
  );
  restoreProperty(
    globalThis.URL,
    'revokeObjectURL',
    originalDescriptors.revokeObjectURL,
  );

  if (typeof globalThis.navigator === 'object') {
    restoreProperty(
      globalThis.navigator,
      'sendBeacon',
      originalDescriptors.sendBeacon,
    );
  }

  if (typeof globalThis.HTMLDialogElement === 'function') {
    restoreProperty(
      globalThis.HTMLDialogElement.prototype,
      'showModal',
      originalDescriptors.showModal,
    );
    restoreProperty(
      globalThis.HTMLDialogElement.prototype,
      'close',
      originalDescriptors.close,
    );
  }
}

/**
 * Enables deterministic fake time for the current test.
 *
 * @param {Date|string|number} [instant] Initial fake time.
 * @returns {Date} Configured test time.
 */
export function useDeterministicTime(instant = FIXED_TEST_TIME) {
  const date =
    instant instanceof Date
      ? new Date(instant.getTime())
      : new Date(instant);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      'Deterministic test time must be a valid date or timestamp.',
    );
  }

  vi.useFakeTimers();
  vi.setSystemTime(date);

  return date;
}

/**
 * Advances deterministic fake time and flushes scheduled callbacks.
 *
 * @param {number} milliseconds Milliseconds to advance.
 * @returns {Promise<void>} Completion promise.
 */
export async function advanceDeterministicTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new TypeError(
      'Test time advance must be a non-negative finite number.',
    );
  }

  await vi.advanceTimersByTimeAsync(milliseconds);
}

/**
 * Restores real runtime timers.
 *
 * @returns {void}
 */
export function restoreRealTime() {
  vi.useRealTimers();
}

beforeEach(() => {
  vi.useRealTimers();
  cryptoSequence = 0;
  clearBrowserStorage();
  installDeterministicCrypto();
  installNetworkGuards();
  installBrowserApiMocks();
});

afterEach(() => {
  cleanup();
  clearBrowserStorage();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreRuntime();

  Object.keys(networkPrimitiveSpies).forEach((key) => {
    networkPrimitiveSpies[key] = null;
  });
});