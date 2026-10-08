// In-memory stand-ins for localStorage and Web Locks. Never imported by the application.
export const password = "public testing recovery password";
export function memoryBrowser() {
  const storage = new Map<string, string>();
  let queue = Promise.resolve();
  return {
    storage,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    },
    navigator: {
      locks: {
        request: (
          _key: string,
          _options: unknown,
          fn: () => Promise<unknown>,
        ) => {
          const result = queue.then(fn);
          queue = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      },
    },
  };
}
