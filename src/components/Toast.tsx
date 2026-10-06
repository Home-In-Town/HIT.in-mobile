import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';

type ToastKind = 'success' | 'error' | 'info';
interface ToastState { message: string; kind: ToastKind }

interface ToastContextType {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [opacity] = useState(new Animated.Value(0));

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind });
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
        setToast(null)
      );
    }, 2600);
  }, [opacity]);

  const success = useCallback((m: string) => show(m, 'success'), [show]);
  const error = useCallback((m: string) => show(m, 'error'), [show]);

  /* ── WHY THE CONTEXT VALUE IS MEMOISED.
     This used to be an inline `value={{ show, success, error }}` object literal
     on the Provider below. Each of the three methods was already referentially
     stable — `show` closes over an `opacity` Animated.Value held in useState, so
     its useCallback never re-runs, and `success`/`error` depend only on `show` —
     but the WRAPPER object around them was reallocated on every provider render.
     ToastProvider re-renders twice per toast (once for the setToast that shows
     it, once for the setToast(null) that hides it 2.6 s later) and it sits at the
     app root in app/_layout.tsx, so every useToast() consumer in the app saw a
     brand-new context identity and re-rendered twice for every toast raised.

     The damage was not cosmetic. In src/components/GroupChatEmbedded.tsx eleven
     useCallbacks list `toast` in their dependency array — handleInterested,
     handlePropertyViewDetails, handleShareProject, handleJoinPropertyGroup,
     handleDeleteMessage, handlePropertyCall, handleMemberCall,
     handleMemberWhatsApp, handleProfilePicUpload, handleIconSelect and
     handleJoin — so all eleven changed identity on each toast. Five of them feed
     renderMessage's deps, which gave renderMessage a new identity, which handed
     the React.memo'd MessageBubble new onInterested / onPropertyViewDetails /
     onPropertyCall / onJoinPropertyGroup / onDeleteMessage props so it could not
     bail out: every visible message bubble re-rendered. handleJoin did the same
     to renderGroupRow → the memo'd GroupRow. Two effects were also torn down and
     re-registered per toast, including the `group_deleted` socket listener.
     Memoising here fixes all of them at the source, and leaves those dependency
     arrays correct rather than merely suppressed — which is why they are not
     being edited.

     Note for the next reader: a consumer that destructured and depended on
     `toast.show` alone was never affected, because `show` itself never changed
     identity. Only consumers depending on the `toast` OBJECT were invalidated,
     and every call site in this codebase does the latter.

     Deliberately NOT fixed here: there is one shared Animated.Value and the hide
     setTimeout is never cleared, so a second toast raised inside the 2.6 s window
     is faded out early by the first toast's timer. That stacking quirk is
     pre-existing and out of scope — this change is identity-only and the visible
     timing (200 ms in / 2600 ms hold / 250 ms out), colours and geometry are
     byte-identical to before. Do not "finish the job" with a timer ref unless
     that behaviour change has actually been asked for.
     ── */
  const value = useMemo(() => ({ show, success, error }), [show, success, error]);

  const bg =
    toast?.kind === 'success' ? '#16A34A' : toast?.kind === 'error' ? '#DC2626' : '#1C1917';

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 60,
            left: 24,
            right: 24,
            opacity,
            alignItems: 'center',
          }}
        >
          <View style={{ backgroundColor: bg, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, maxWidth: '90%' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' }}>
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
