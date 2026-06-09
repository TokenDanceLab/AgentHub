import React from 'react';
import {
  AccessibilityInfo,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { shouldReduceMotion } from '@/theme';

type MotionFeedback = 'control' | 'icon' | 'row';

interface MotionPressFeedbackOptions {
  pressed: boolean;
  disabled?: boolean;
  reducedMotion?: boolean;
  feedback?: MotionFeedback;
  pressedOpacity?: number | undefined;
  disabledOpacity?: number | undefined;
  pressedScale?: number | undefined;
}

interface MotionPressableState extends PressableStateCallbackType {
  disabled: boolean;
  reducedMotion: boolean;
}

interface MotionPressableProps extends Omit<PressableProps, 'children' | 'disabled' | 'style'> {
  children?: React.ReactNode | ((state: MotionPressableState) => React.ReactNode);
  disabled?: boolean;
  disabledOpacity?: number;
  feedback?: MotionFeedback;
  pressedOpacity?: number;
  pressedScale?: number;
  style?: StyleProp<ViewStyle> | ((state: MotionPressableState) => StyleProp<ViewStyle>);
}

const feedbackDefaults: Record<
  MotionFeedback,
  { disabledOpacity: number; pressedOpacity: number; pressedScale: number }
> = {
  control: { disabledOpacity: 0.58, pressedOpacity: 0.9, pressedScale: 0.985 },
  icon: { disabledOpacity: 0.46, pressedOpacity: 0.72, pressedScale: 0.94 },
  row: { disabledOpacity: 0.58, pressedOpacity: 0.94, pressedScale: 0.992 },
};

export function resolveMotionPressFeedback({
  pressed,
  disabled = false,
  reducedMotion = false,
  feedback = 'control',
  pressedOpacity,
  disabledOpacity,
  pressedScale,
}: MotionPressFeedbackOptions): ViewStyle {
  const defaults = feedbackDefaults[feedback];

  if (disabled) {
    return {
      opacity: disabledOpacity ?? defaults.disabledOpacity,
      transform: [{ scale: 1 }],
    };
  }

  if (!pressed) {
    return {
      opacity: 1,
      transform: [{ scale: 1 }],
    };
  }

  return {
    opacity: pressedOpacity ?? defaults.pressedOpacity,
    transform: [{ scale: reducedMotion ? 1 : (pressedScale ?? defaults.pressedScale) }],
  };
}

function useReducedMotionPreference(): boolean {
  const [accessibilityReduceMotion, setAccessibilityReduceMotion] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setAccessibilityReduceMotion(enabled);
        }
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setAccessibilityReduceMotion(enabled);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return shouldReduceMotion(accessibilityReduceMotion);
}

export function MotionPressable({
  children,
  disabled = false,
  disabledOpacity,
  feedback = 'control',
  hitSlop,
  pressedOpacity,
  pressedScale,
  style,
  ...pressableProps
}: MotionPressableProps): React.ReactElement {
  const reducedMotion = useReducedMotionPreference();

  return (
    <Pressable
      {...pressableProps}
      disabled={disabled}
      hitSlop={hitSlop === undefined ? 4 : hitSlop}
      style={(state) => {
        const motionState = { ...state, disabled, reducedMotion };
        const resolvedStyle = typeof style === 'function' ? style(motionState) : style;

        return [
          resolvedStyle,
          resolveMotionPressFeedback({
            pressed: state.pressed,
            disabled,
            reducedMotion,
            feedback,
            pressedOpacity,
            disabledOpacity,
            pressedScale,
          }),
        ];
      }}
    >
      {(state) => {
        const motionState = { ...state, disabled, reducedMotion };
        return typeof children === 'function' ? children(motionState) : children;
      }}
    </Pressable>
  );
}
