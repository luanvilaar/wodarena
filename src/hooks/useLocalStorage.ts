'use client';

import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [
  T,
  (value: T | ((val: T) => T)) => void,
  boolean
] {
  // Estado para guardar nosso valor
  // Passa função inicial para o useState para que a lógica só rode uma vez
  const [storedValue, setStoredValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  // useEffect para sincronizar com localStorage após a montagem do componente no cliente
  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        // Browser storage is the external source of truth after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStoredValue(JSON.parse(item));
      }
    } catch (error) {
      console.warn(`Erro ao ler localStorage com chave "${key}":`, error);
    } finally {
      setIsHydrated(true);
    }
  }, [key]);

  // Retorna uma versão envelopada da função setter do useState que persiste o novo valor no localStorage.
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      // Mantem a identidade do setter estavel para evitar loops de efeitos
      // em consumidores que o utilizam em dependencias de useEffect/useCallback.
      setStoredValue((currentValue) => {
        const valueToStore = value instanceof Function ? value(currentValue) : value;

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }

        return valueToStore;
      });
    } catch (error) {
      console.warn(`Erro ao salvar localStorage com chave "${key}":`, error);
    }
  }, [key]);

  return [storedValue, setValue, isHydrated];
}
