'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

// Gesto "toque e segure" da súmula do judge (Story 1.44): um toque rápido
// chama `onTap`; segurar por HOLD_MS chama `onHold` e cancela o toque. Os
// valores são constantes únicas para ajustar depois de ver no aparelho.

/** Tempo segurando para concluir o segmento. */
export const HOLD_MS = 700;
/** Movimento do dedo (px) acima do qual o gesto é cancelado. */
export const MOVE_TOLERANCE_PX = 12;
/** Intervalo mínimo entre dois toques: o segundo é tratado como registro duplicado. */
export const MIN_TAP_GAP_MS = 120;

// Um gesto sem pointerup por mais que isso é tratado como perdido (o aparelho
// não avisou o fim), para um toque novo não ser ignorado para sempre.
const STALE_GESTURE_MS = HOLD_MS * 4;

const TAP_VIBRATION_MS = 12;
const HOLD_VIBRATION_MS = 40;

const vibrate = (duration: number) => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(duration);
  } catch {
    // Sem vibração no aparelho: o feedback visual basta.
  }
};

type UseTapHoldOptions = {
  onTap: () => void;
  onHold: () => void;
  disabled?: boolean;
};

export function useTapHold({ onTap, onHold, disabled = false }: UseTapHoldOptions) {
  const [holding, setHolding] = useState(false);
  const gesture = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startedAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    held: boolean;
    cancelled: boolean;
    lastTapAt: number;
  }>({ pointerId: null, startX: 0, startY: 0, startedAt: 0, timer: null, held: false, cancelled: false, lastTapAt: 0 });

  // Sempre o callback mais recente, sem recriar os handlers a cada render.
  const callbacks = useRef({ onTap, onHold });
  useEffect(() => {
    callbacks.current = { onTap, onHold };
  });

  const clearTimer = useCallback(() => {
    if (gesture.current.timer) clearTimeout(gesture.current.timer);
    gesture.current.timer = null;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    gesture.current.pointerId = null;
    gesture.current.held = false;
    gesture.current.cancelled = false;
    setHolding(false);
  }, [clearTimer]);

  // Desmontar solta o temporizador.
  useEffect(() => clearTimer, [clearTimer]);
  // Desligar o gesto no meio dele (a fase mudou) cancela o que estava em curso.
  useEffect(() => {
    if (!disabled) return;
    clearTimer();
    gesture.current.pointerId = null;
    const timer = setTimeout(() => setHolding(false), 0);
    return () => clearTimeout(timer);
  }, [disabled, clearTimer]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Outro dedo durante um gesto em curso é ignorado; um gesto antigo demais é considerado perdido.
    if (gesture.current.pointerId !== null) {
      if (Date.now() - gesture.current.startedAt < STALE_GESTURE_MS) return;
      clearTimer();
    }
    gesture.current.pointerId = event.pointerId;
    gesture.current.startedAt = Date.now();
    gesture.current.startX = event.clientX;
    gesture.current.startY = event.clientY;
    gesture.current.held = false;
    gesture.current.cancelled = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Captura indisponível: o gesto segue pelos eventos do próprio elemento.
    }
    setHolding(true);
    gesture.current.timer = setTimeout(() => {
      gesture.current.timer = null;
      gesture.current.held = true;
      gesture.current.lastTapAt = Date.now();
      setHolding(false);
      vibrate(HOLD_VIBRATION_MS);
      callbacks.current.onHold();
    }, HOLD_MS);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current.pointerId !== event.pointerId || gesture.current.cancelled || gesture.current.held) return;
    const distance = Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY);
    if (distance > MOVE_TOLERANCE_PX) {
      gesture.current.cancelled = true;
      clearTimer();
      setHolding(false);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current.pointerId !== event.pointerId) return;
    const { held, cancelled, lastTapAt } = gesture.current;
    const now = Date.now();
    const isTap = !held && !cancelled && now - lastTapAt >= MIN_TAP_GAP_MS;
    reset();
    if (isTap) {
      gesture.current.lastTapAt = now;
      vibrate(TAP_VIBRATION_MS);
      callbacks.current.onTap();
    }
  };

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current.pointerId !== event.pointerId) return;
    reset();
  };

  // Enter e Espaço chegam como click sem ponteiro (detail 0): somam uma repetição.
  // Segurar não tem equivalente de teclado; para isso existe o botão "Concluir segmento".
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (disabled || event.detail !== 0) return;
    callbacks.current.onTap();
  };

  return {
    holding: holding && !disabled,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick,
      // Segurar abre o menu de contexto no celular; aqui é o gesto de concluir.
      onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault()
    }
  };
}
