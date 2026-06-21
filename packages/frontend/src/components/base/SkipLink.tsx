/**
 * Skip to main content link for the Senior Citizen Health Checkup System.
 * Allows keyboard users to bypass repetitive navigation and jump to main content.
 *
 * Requirements: 13.4, 13.5
 */

import React from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkipLinkProps {
  /** Target element ID to skip to (defaults to 'main-content') */
  targetId?: string;
  /** Link text (defaults to 'Skip to main content') */
  label?: string;
  /** Additional CSS class */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Skip link component.
 *
 * - Visually hidden until focused via keyboard (Tab)
 * - On activation, moves focus to the main content area
 * - Standard accessibility pattern for keyboard navigation (Req 13.4)
 * - Uses semantic link with proper focus management
 *
 * CSS note: The skip link should be styled as visually hidden (position: absolute,
 * off-screen) and revealed on :focus with position reset to visible.
 */
export const SkipLink: React.FC<SkipLinkProps> = ({
  targetId = 'main-content',
  label = 'Skip to main content',
  className,
}) => {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus();
      // Remove the tabindex after focus so it doesn't interfere with normal tab order
      target.addEventListener(
        'blur',
        () => {
          target.removeAttribute('tabindex');
        },
        { once: true },
      );
    }
  };

  return React.createElement(
    'a',
    {
      href: `#${targetId}`,
      className: `skip-link ${className ?? ''}`.trim(),
      onClick: handleClick,
    },
    label,
  );
};

export default SkipLink;
