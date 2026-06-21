/**
 * Accessible Button component for the Senior Citizen Health Checkup System.
 * Supports large button mode (44×44px minimum with 8px spacing) per requirement 13.7.
 * Includes proper ARIA attributes, keyboard navigation, and focus indicators.
 *
 * Requirements: 13.4, 13.5, 13.7
 */

import React from 'react';
import { LARGE_BUTTON_SIZE, DEFAULT_BUTTON_SIZE, FOCUS_INDICATOR } from '../../config/accessibility';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'default' | 'large';

export interface ButtonProps {
  /** Button content */
  children: React.ReactNode;
  /** Visual variant */
  variant?: ButtonVariant;
  /** Size mode — 'large' enforces 44×44px minimum per requirement 13.7 */
  size?: ButtonSize;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** HTML button type */
  type?: 'button' | 'submit' | 'reset';
  /** Click handler */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Keyboard event handler */
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Accessible label (used when text content is not descriptive enough) */
  ariaLabel?: string;
  /** ID of the element this button describes/controls */
  ariaDescribedBy?: string;
  /** Whether this button controls an expanded region */
  ariaExpanded?: boolean;
  /** Whether this button is pressed (toggle button) */
  ariaPressed?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Element ID */
  id?: string;
}

// ─── Style Computation ───────────────────────────────────────────────────────

export interface ButtonStyles {
  minWidth: string;
  minHeight: string;
  margin: string;
  outlineWidth: string;
  outlineStyle: string;
  outlineOffset: string;
}

/**
 * Compute inline styles for the button based on size mode.
 */
export function getButtonStyles(size: ButtonSize): ButtonStyles {
  const sizeConfig = size === 'large' ? LARGE_BUTTON_SIZE : DEFAULT_BUTTON_SIZE;

  return {
    minWidth: `${sizeConfig.minWidth}px`,
    minHeight: `${sizeConfig.minHeight}px`,
    margin: `${sizeConfig.spacing / 2}px`,
    outlineWidth: `${FOCUS_INDICATOR.width}px`,
    outlineStyle: FOCUS_INDICATOR.style,
    outlineOffset: `${FOCUS_INDICATOR.offset}px`,
  };
}

/**
 * Get ARIA props for the button.
 */
export function getButtonAriaProps(props: ButtonProps): Record<string, string | boolean | undefined> {
  const ariaProps: Record<string, string | boolean | undefined> = {};

  if (props.ariaLabel) {
    ariaProps['aria-label'] = props.ariaLabel;
  }
  if (props.ariaDescribedBy) {
    ariaProps['aria-describedby'] = props.ariaDescribedBy;
  }
  if (props.ariaExpanded !== undefined) {
    ariaProps['aria-expanded'] = props.ariaExpanded;
  }
  if (props.ariaPressed !== undefined) {
    ariaProps['aria-pressed'] = props.ariaPressed;
  }
  if (props.disabled) {
    ariaProps['aria-disabled'] = true;
  }

  return ariaProps;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Accessible Button component.
 *
 * - Large mode renders at minimum 44×44px with 8px spacing (Req 13.7)
 * - Focus indicator: 2px solid outline (Req 13.4)
 * - Full keyboard support: Enter and Space activate (Req 13.4)
 * - Screen reader compatible with ARIA labels (Req 13.5)
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'default',
  disabled = false,
  type = 'button',
  onClick,
  onKeyDown,
  ariaLabel,
  ariaDescribedBy,
  ariaExpanded,
  ariaPressed,
  className,
  id,
}) => {
  const styles = getButtonStyles(size);
  const ariaProps = getButtonAriaProps({
    children,
    ariaLabel,
    ariaDescribedBy,
    ariaExpanded,
    ariaPressed,
    disabled,
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (onKeyDown) {
      onKeyDown(event);
    }
    // Native button already handles Enter and Space — no extra handling needed
  };

  return React.createElement(
    'button',
    {
      id,
      type,
      disabled,
      onClick: disabled ? undefined : onClick,
      onKeyDown: handleKeyDown,
      className: `btn btn--${variant} btn--${size} ${className ?? ''}`.trim(),
      style: {
        minWidth: styles.minWidth,
        minHeight: styles.minHeight,
        margin: styles.margin,
      },
      ...ariaProps,
    },
    children,
  );
};

export default Button;
