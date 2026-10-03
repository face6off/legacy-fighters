import { AsyncLocalStorage } from 'node:async_hooks';

// Each request receives its room's SQL database; never share a mutable global
// binding between concurrent rooms. Existing D1-backed routes remain supported.
export const roomDatabase = new AsyncLocalStorage<any>();
