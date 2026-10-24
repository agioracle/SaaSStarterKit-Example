import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { m } from '../../locale/paraglide/messages';

export interface ToastInput {
  title: string;
  description?: string;
  kind?: 'info' | 'success' | 'error';
  /** Milliseconds. Zero keeps a notice until dismissal. Defaults to 5s, or 9s for errors. */
  duration?: number;
}
export interface ToastMessage extends ToastInput {
  id: string;
  kind: 'info' | 'success' | 'error';
  duration: number;
}
export type ToastAction =
  | { type: 'add'; toast: ToastMessage }
  | { type: 'dismiss'; id: string }
  | { type: 'clear' };
export function toastDuration(input: ToastInput): number {
  const fallback = input.kind === 'error' ? 9000 : 5000;
  return input.duration === 0
    ? 0
    : typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0
      ? Math.max(1000, Math.min(60000, input.duration))
      : fallback;
}
export function toastReducer(state: ToastMessage[], action: ToastAction): ToastMessage[] {
  if (action.type === 'clear') return [];
  if (action.type === 'dismiss') return state.filter((item) => item.id !== action.id);
  return [...state.filter((item) => item.id !== action.toast.id), action.toast].slice(-5);
}
export function scheduleToastDismiss(message: ToastMessage, dismiss: (id: string) => void) {
  if (!message.duration) return () => {};
  const timer = setTimeout(() => dismiss(message.id), message.duration);
  return () => clearTimeout(timer);
}
interface ToastApi {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}
const ToastContext = createContext<ToastApi | null>(null);

/**
 * Mount once inside the app's root providers. Queue state is local to that React tree,
 * never shared between SSR requests. Example:
 * const { toast } = useToast(); toast({ title: m.saved(), kind: 'success' });
 * Notify only after a real operation succeeds. Never include passwords, keys or tokens.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, dispatch] = useReducer(toastReducer, []);
  const prefix = useId();
  const sequence = useRef(0);
  const toast = useCallback(
    (input: ToastInput) => {
      const id = `${prefix}-${++sequence.current}`;
      dispatch({
        type: 'add',
        toast: { ...input, id, kind: input.kind || 'info', duration: toastDuration(input) },
      });
      return id;
    },
    [prefix],
  );
  const dismiss = useCallback((id: string) => dispatch({ type: 'dismiss', id }), []);
  const dismissAll = useCallback(() => dispatch({ type: 'clear' }), []);
  const api = useMemo(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport messages={messages} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider.');
  return context;
}
export function ToastViewport({
  messages,
  dismiss,
}: {
  messages: ToastMessage[];
  dismiss: (id: string) => void;
}) {
  return (
    <section
      aria-label={m.shared_toaster_notifications()}
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
        zIndex: 100,
        width: 'min(25rem, calc(100vw - 2rem))',
        pointerEvents: 'none',
      }}
    >
      <div role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions text">
        {messages
          .filter((item) => item.kind !== 'error')
          .map((message) => (
            <ToastNotice key={message.id} message={message} dismiss={dismiss} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false" aria-relevant="additions text">
        {messages
          .filter((item) => item.kind === 'error')
          .map((message) => (
            <ToastNotice key={message.id} message={message} dismiss={dismiss} />
          ))}
      </div>
    </section>
  );
}
function ToastNotice({
  message,
  dismiss,
}: {
  message: ToastMessage;
  dismiss: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    return scheduleToastDismiss(message, dismiss);
  }, [message, dismiss, hovered, focused]);
  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        gap: '1rem',
        alignItems: 'start',
        padding: '1rem',
        marginTop: '.75rem',
        border: `1px solid ${message.kind === 'error' ? 'var(--danger)' : 'var(--line)'}`,
        borderRadius: '.75rem',
        background: 'var(--surface)',
        color: 'var(--ink)',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        <strong>{message.title}</strong>
        {message.description && (
          <p style={{ margin: '.35rem 0 0', fontSize: '.875rem' }}>{message.description}</p>
        )}
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={m.shared_toaster_dismiss()}
        onClick={() => dismiss(message.id)}
      >
        ×
      </button>
    </article>
  );
}
