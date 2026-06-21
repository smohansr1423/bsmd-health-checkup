/**
 * Main application layout with landmark regions for the Senior Citizen Health Checkup System.
 * Defines the overall page structure with proper ARIA roles for screen reader navigation.
 *
 * Requirements: 13.4, 13.5, 13.9
 */

import React from 'react';
import { LANDMARKS } from '../../config/accessibility';
import { SkipLink } from '../base/SkipLink';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppLayoutProps {
  /** Header content (site branding, user menu) */
  header?: React.ReactNode;
  /** Navigation content */
  navigation?: React.ReactNode;
  /** Main page content */
  children: React.ReactNode;
  /** Sidebar/complementary content */
  aside?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Document direction for RTL support */
  direction?: 'ltr' | 'rtl';
  /** Language code for the document */
  lang?: string;
  /** Additional CSS class */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * AppLayout component providing the main page structure.
 *
 * Landmark regions (Req 13.5):
 * - banner (header) — site-wide header with branding
 * - navigation — main navigation menu
 * - main — primary content area (target of skip link)
 * - complementary — sidebar/supplementary info
 * - contentinfo (footer) — site-wide footer
 *
 * Accessibility features:
 * - Skip link to bypass navigation (Req 13.4)
 * - ARIA landmark roles with descriptive labels (Req 13.5)
 * - RTL direction support via dir attribute
 * - Screen reader live region for announcements (Req 13.5)
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
  header,
  navigation,
  children,
  aside,
  footer,
  direction = 'ltr',
  lang = 'en',
  className,
}) => {
  return React.createElement(
    'div',
    {
      className: `app-layout ${className ?? ''}`.trim(),
      dir: direction,
      lang,
    },
    // Skip link — first focusable element
    React.createElement(SkipLink, null),

    // Screen reader live region for dynamic announcements
    React.createElement('div', {
      id: 'sr-announcements',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      role: 'status',
      className: 'sr-only',
    }),

    // Header / Banner landmark
    header &&
      React.createElement(
        'header',
        {
          role: LANDMARKS.header.role,
          'aria-label': LANDMARKS.header.label,
          className: 'app-layout__header',
        },
        header,
      ),

    // Navigation landmark
    navigation &&
      React.createElement(
        'div',
        { className: 'app-layout__navigation' },
        navigation,
      ),

    // Main content area
    React.createElement(
      'div',
      { className: 'app-layout__body' },
      // Main landmark
      React.createElement(
        'main',
        {
          id: 'main-content',
          role: LANDMARKS.main.role,
          'aria-label': LANDMARKS.main.label,
          className: 'app-layout__main',
        },
        children,
      ),

      // Complementary landmark (sidebar)
      aside &&
        React.createElement(
          'aside',
          {
            role: LANDMARKS.complementary.role,
            'aria-label': LANDMARKS.complementary.label,
            className: 'app-layout__aside',
          },
          aside,
        ),
    ),

    // Footer / Content info landmark
    footer &&
      React.createElement(
        'footer',
        {
          role: LANDMARKS.footer.role,
          'aria-label': LANDMARKS.footer.label,
          className: 'app-layout__footer',
        },
        footer,
      ),
  );
};

export default AppLayout;
