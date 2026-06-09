import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useStrings } from '@/i18n/strings';
import { shouldReduceMotion, useAgentHubTheme } from '@/theme';

import { Button } from './Button';
import { getBottomSheetFrame, getBottomSheetTiming } from './BottomSheet.motion';

interface BottomSheetProps {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  primaryAction?: {
    label: string;
    onPress: () => void;
    danger?: boolean;
  } | undefined;
}

export function BottomSheet({
  title,
  visible,
  onClose,
  children,
  primaryAction,
}: BottomSheetProps): ReactElement | null {
  const { tokens } = useAgentHubTheme();
  const t = useStrings();
  const { width, height } = useWindowDimensions();
  const [isMounted, setIsMounted] = useState(visible);
  const [accessibilityReduceMotion, setAccessibilityReduceMotion] = useState<boolean | null>(null);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  const isExiting = useRef(false);
  const reduceMotion = shouldReduceMotion(accessibilityReduceMotion);
  const timing = getBottomSheetTiming(reduceMotion);
  const frame = getBottomSheetFrame(width, height);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) {
          setAccessibilityReduceMotion(enabled);
        }
      })
      .catch(() => {
        if (active) {
          setAccessibilityReduceMotion(false);
        }
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setAccessibilityReduceMotion);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const runAnimation = useCallback((
    toValue: number,
    onComplete?: () => void,
  ) => {
    progress.stopAnimation();

    if (reduceMotion) {
      progress.setValue(toValue);
      onComplete?.();
      return;
    }

    Animated.timing(progress, {
      toValue,
      duration: timing.sheetMs,
      easing: toValue === 1 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onComplete?.();
      }
    });
  }, [progress, reduceMotion, timing.sheetMs]);

  const closeWithAnimation = useCallback(() => {
    if (isExiting.current) {
      return;
    }

    isExiting.current = true;
    runAnimation(0, () => {
      isExiting.current = false;
      setIsMounted(false);
      onClose();
    });
  }, [onClose, runAnimation]);

  useEffect(() => {
    if (visible) {
      isExiting.current = false;
      queueMicrotask(() => {
        setIsMounted(true);
      });
    }
  }, [visible]);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    if (visible) {
      runAnimation(1);
      return;
    }

    runAnimation(0, () => {
      setIsMounted(false);
    });
  }, [isMounted, runAnimation, visible]);

  if (!isMounted) {
    return null;
  }

  const sheetTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 0],
  });
  const sheetOpacity = progress.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [0, 0.98, 1],
  });
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Modal animationType="none" transparent visible={isMounted} onRequestClose={() => closeWithAnimation()}>
      <View style={{ flex: 1, alignItems: frame.maxWidth ? 'center' : 'stretch', justifyContent: 'flex-end' }}>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <Pressable
            accessibilityLabel={t.closeSheet}
            accessibilityRole="button"
            onPress={() => closeWithAnimation()}
            style={[StyleSheet.absoluteFill, { backgroundColor: tokens.color.scrim }]}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={{
            borderTopLeftRadius: tokens.radius.sheet,
            borderTopRightRadius: tokens.radius.sheet,
            borderWidth: 1,
            borderColor: tokens.color.line,
            backgroundColor: tokens.color.panel,
            padding: tokens.space.lg,
            gap: tokens.space.lg,
            width: '100%',
            ...(frame.maxWidth ? { maxWidth: frame.maxWidth } : {}),
            maxHeight: frame.maxHeight,
            opacity: sheetOpacity,
            transform: [{ translateY: sheetTranslateY }],
          }}
        >
          <Pressable
            accessibilityLabel={t.closeSheet}
            accessibilityRole="button"
            onPress={() => closeWithAnimation()}
            style={{
              alignSelf: 'center',
              minHeight: tokens.touch.minimum,
              minWidth: tokens.touch.minimum,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 42,
                height: 4,
                borderRadius: 999,
                backgroundColor: tokens.color.line,
              }}
            />
          </Pressable>
          <Text style={{ color: tokens.color.ink, fontSize: tokens.type.lg, fontWeight: tokens.type.weight.semibold }}>{title}</Text>
          {children}
          {primaryAction ? (
            <Button
              label={primaryAction.label}
              onPress={primaryAction.onPress}
              variant={primaryAction.danger ? 'danger' : 'primary'}
            />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}
