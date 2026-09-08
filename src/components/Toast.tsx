import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
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

  const bg =
    toast?.kind === 'success' ? '#16A34A' : toast?.kind === 'error' ? '#DC2626' : '#1C1917';

  return (
    <ToastContext.Provider value={{ show, success, error }}>
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
