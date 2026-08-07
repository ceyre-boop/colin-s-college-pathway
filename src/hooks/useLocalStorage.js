import { useState, useEffect } from 'react';

/**
 * @param key            current storage key
 * @param initialValue   used when nothing is stored under `key` or `migrate.fromKey`
 * @param migrate        optional one-time upconversion: { fromKey, convert } — when `key` is empty
 *                       but `fromKey` holds data, the old blob is read, converted, and written
 *                       under the new key. The old key is left in place so a bad migration is
 *                       recoverable by hand rather than being a one-way door.
 */
export function useLocalStorage(key, initialValue, migrate) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) return JSON.parse(item);

      if (migrate?.fromKey) {
        const old = window.localStorage.getItem(migrate.fromKey);
        if (old) {
          const converted = migrate.convert ? migrate.convert(JSON.parse(old)) : JSON.parse(old);
          window.localStorage.setItem(key, JSON.stringify(converted));
          return converted;
        }
      }
      return initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch {
      // ignore write errors
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}
