/**
 * askit - Guest Entry
 *
 * This is the main entry point for QuickJS / Keel sandbox environment.
 * Exports DSL identifiers that map to host components.
 */

// APIs (Guest implementations)
export { ask, EventEmitter, Haptic, http, Toast } from './api/index.guest';
// Types (same as host for consistent API)
export type {
  BaseProps,
  // ChatBubble
  ChatBubbleProps,
  Environment,
  EventCallback,
  // EventEmitter
  EventEmitterAPI,
  // Haptic
  HapticAPI,
  HapticType,
  MyTouchableOpacityProps,
  StepItem,
  // StepList
  StepListProps,
  StepStatus,
  StyleObject,
  StyleProp,
  // ThemeView
  ThemeViewProps,
  // Toast
  ToastAPI,
  ToastDuration,
  ToastOptions,
  ToastPosition,
  // UserAvatar
  UserAvatarProps,
} from './types';
// UI Components (DSL identifiers)
export {
  ChatBubble,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSubText,
  DropdownMenuText,
  GlobalAlert,
  MyTouchableOpacity,
  Panel,
  StepList,
  ThemeView,
  UserAvatar,
} from './ui/index.guest';
