/**
 * Accessible Navigation component for the Senior Citizen Health Checkup System.
 * Supports simplified mode (≤6 items) with full keyboard navigation.
 *
 * Requirements: 13.4, 13.5, 13.9
 */

import React from 'react';
import {
  SIMPLIFIED_NAV_MAX_ITEMS,
  KEYBOARD_KEYS,
  LANDMARKS,
} from '../../config/accessibility';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NavigationItem {
  /** Unique item key */
  id: string;
  /** Display label */
  label: string;
  /** Navigation target (URL or route) */
  href: string;
  /** Icon identifier (optional) */
  icon?: string;
  /** Whether this item is currently active */
  isActive?: boolean;
  /** Accessible description */
  ariaLabel?: string;
}

export interface NavigationProps {
  /** Navigation items to display */
  items: NavigationItem[];
  /** Whether simplified mode is enabled (limits to 6 items) */
  simplified?: boolean;
  /** Orientation of the navigation */
  orientation?: 'horizontal' | 'vertical';
  /** Accessible label for the navigation region */
  ariaLabel?: string;
  /** Callback when a navigation item is selected */
  onNavigate?: (item: NavigationItem) => void;
  /** Additional CSS class */
  className?: string;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Filter items to respect simplified navigation limit (max 6 items).
 */
export function getVisibleItems(items: NavigationItem[], simplified: boolean): NavigationItem[] {
  if (!simplified) return items;
  return items.slice(0, SIMPLIFIED_NAV_MAX_ITEMS);
}

/**
 * Handle keyboard navigation within the nav list.
 * Supports Arrow keys for item traversal, Home/End for first/last.
 */
export function handleNavKeyDown(
  event: React.KeyboardEvent,
  currentIndex: number,
  itemCount: number,
  onIndexChange: (index: number) => void,
  onSelect: () => void,
  onClose?: () => void,
): void {
  switch (event.key) {
    case KEYBOARD_KEYS.ARROW_DOWN:
    case KEYBOARD_KEYS.ARROW_RIGHT:
      event.preventDefault();
      onIndexChange((currentIndex + 1) % itemCount);
      break;
    case KEYBOARD_KEYS.ARROW_UP:
    case KEYBOARD_KEYS.ARROW_LEFT:
      event.preventDefault();
      onIndexChange((currentIndex - 1 + itemCount) % itemCount);
      break;
    case KEYBOARD_KEYS.HOME:
      event.preventDefault();
      onIndexChange(0);
      break;
    case KEYBOARD_KEYS.END:
      event.preventDefault();
      onIndexChange(itemCount - 1);
      break;
    case KEYBOARD_KEYS.ENTER:
    case KEYBOARD_KEYS.SPACE:
      event.preventDefault();
      onSelect();
      break;
    case KEYBOARD_KEYS.ESCAPE:
      if (onClose) {
        event.preventDefault();
        onClose();
      }
      break;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Accessible Navigation component.
 *
 * - Simplified mode limits to ≤6 items (Req 13.9)
 * - Full keyboard navigation: Arrow keys, Home, End, Enter, Escape (Req 13.4)
 * - Proper ARIA roles: navigation landmark, aria-current for active item (Req 13.5)
 * - Focus management with roving tabindex pattern
 */
export const Navigation: React.FC<NavigationProps> = ({
  items,
  simplified = false,
  orientation = 'horizontal',
  ariaLabel,
  onNavigate,
  className,
}) => {
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const visibleItems = getVisibleItems(items, simplified);
  const navLabel = ariaLabel ?? LANDMARKS.navigation.label;

  const handleSelect = (item: NavigationItem) => {
    if (onNavigate) {
      onNavigate(item);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    handleNavKeyDown(
      event,
      index,
      visibleItems.length,
      setFocusedIndex,
      () => handleSelect(visibleItems[index]),
    );
  };

  return React.createElement(
    'nav',
    {
      role: 'navigation',
      'aria-label': navLabel,
      className: `nav nav--${orientation} ${simplified ? 'nav--simplified' : ''} ${className ?? ''}`.trim(),
    },
    React.createElement(
      'ul',
      {
        role: 'menubar',
        'aria-orientation': orientation,
        className: 'nav__list',
      },
      ...visibleItems.map((item, index) =>
        React.createElement(
          'li',
          {
            key: item.id,
            role: 'none',
            className: 'nav__item',
          },
          React.createElement(
            'a',
            {
              href: item.href,
              role: 'menuitem',
              tabIndex: index === focusedIndex ? 0 : -1,
              'aria-current': item.isActive ? 'page' : undefined,
              'aria-label': item.ariaLabel ?? item.label,
              className: `nav__link ${item.isActive ? 'nav__link--active' : ''}`.trim(),
              onClick: (e: React.MouseEvent) => {
                e.preventDefault();
                handleSelect(item);
              },
              onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, index),
            },
            item.label,
          ),
        ),
      ),
    ),
  );
};

export default Navigation;
