'use client';

import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // Estado para guardar nosso valor
  // Passa função inicial para o useState para que a lógica só rode uma vez
  const [storedValue, setStoredValue] = useState<T>(initialValue);

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
    }
  }, [key]);

  // Retorna uma versão envelopada da função setter do useState que persiste o novo valor no localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Permite que o valor seja uma função para termos a mesma API do useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      
      // Salva o estado
      setStoredValue(valueToStore);
      
      // Salva no localStorage
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.warn(`Erro ao salvar localStorage com chave "${key}":`, error);
    }
  };

  return [storedValue, setValue];
}
