/**
 * Accessible FormField component for the Senior Citizen Health Checkup System.
 * Provides proper ARIA labels, error announcements, and keyboard navigation.
 *
 * Requirements: 13.4, 13.5
 */

import React from 'react';
import { FOCUS_INDICATOR } from '../../config/accessibility';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FormFieldType = 'text' | 'email' | 'tel' | 'number' | 'date' | 'password' | 'select' | 'textarea';

export interface FormFieldProps {
  /** Unique field identifier */
  id: string;
  /** Human-readable label text */
  label: string;
  /** Input type */
  type?: FormFieldType;
  /** Current field value */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is read-only */
  readOnly?: boolean;
  /** Error message (displays inline and announced to screen readers) */
  error?: string;
  /** Help/description text */
  helpText?: string;
  /** Change handler */
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  /** Blur handler */
  onBlur?: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  /** Select options (for type='select') */
  options?: Array<{ value: string; label: string }>;
  /** Additional CSS class */
  className?: string;
  /** Accessible label override (if label is not visible) */
  ariaLabel?: string;
  /** Min value (for number/date) */
  min?: string;
  /** Max value (for number/date) */
  max?: string;
  /** Autocomplete attribute */
  autoComplete?: string;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Generate computed ARIA attributes for the form field.
 */
export function getFormFieldAriaProps(props: FormFieldProps): Record<string, string | boolean | undefined> {
  const errorId = `${props.id}-error`;
  const helpId = `${props.id}-help`;
  const labelId = `${props.id}-label`;

  const describedBy: string[] = [];
  if (props.error) describedBy.push(errorId);
  if (props.helpText) describedBy.push(helpId);

  const ariaProps: Record<string, string | boolean | undefined> = {
    'aria-labelledby': labelId,
    'aria-required': props.required || undefined,
    'aria-invalid': props.error ? true : undefined,
    'aria-disabled': props.disabled || undefined,
    'aria-readonly': props.readOnly || undefined,
  };

  if (props.ariaLabel) {
    ariaProps['aria-label'] = props.ariaLabel;
  }

  if (describedBy.length > 0) {
    ariaProps['aria-describedby'] = describedBy.join(' ');
  }

  return ariaProps;
}

/**
 * Get focus indicator styles for the field.
 */
export function getFieldFocusStyles(): Record<string, string> {
  return {
    outlineWidth: `${FOCUS_INDICATOR.width}px`,
    outlineStyle: FOCUS_INDICATOR.style,
    outlineOffset: `${FOCUS_INDICATOR.offset}px`,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Accessible FormField component.
 *
 * - Associates label with input via htmlFor/id (Req 13.5)
 * - Error messages are linked via aria-describedby and announced with role="alert" (Req 13.5)
 * - Help text linked via aria-describedby
 * - Required fields marked with aria-required
 * - Focus indicator: 2px solid outline (Req 13.4)
 */
export const FormField: React.FC<FormFieldProps> = (props) => {
  const {
    id,
    label,
    type = 'text',
    value,
    placeholder,
    required = false,
    disabled = false,
    readOnly = false,
    error,
    helpText,
    onChange,
    onBlur,
    options,
    className,
    min,
    max,
    autoComplete,
  } = props;

  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const labelId = `${id}-label`;
  const ariaProps = getFormFieldAriaProps(props);

  const commonInputProps = {
    id,
    name: id,
    value,
    placeholder,
    disabled,
    readOnly,
    onChange,
    onBlur,
    autoComplete,
    ...ariaProps,
  };

  // Render the appropriate input element
  let inputElement: React.ReactElement;

  if (type === 'select' && options) {
    inputElement = React.createElement(
      'select',
      commonInputProps,
      React.createElement('option', { value: '' }, placeholder ?? 'Select...'),
      ...options.map((opt) =>
        React.createElement('option', { key: opt.value, value: opt.value }, opt.label),
      ),
    );
  } else if (type === 'textarea') {
    inputElement = React.createElement('textarea', {
      ...commonInputProps,
      rows: 4,
    });
  } else {
    inputElement = React.createElement('input', {
      ...commonInputProps,
      type,
      min,
      max,
    });
  }

  return React.createElement(
    'div',
    { className: `form-field ${error ? 'form-field--error' : ''} ${className ?? ''}`.trim() },
    // Label
    React.createElement(
      'label',
      { id: labelId, htmlFor: id, className: 'form-field__label' },
      label,
      required && React.createElement('span', { 'aria-hidden': 'true', className: 'form-field__required' }, ' *'),
    ),
    // Help text
    helpText &&
      React.createElement(
        'span',
        { id: helpId, className: 'form-field__help' },
        helpText,
      ),
    // Input element
    inputElement,
    // Error message — role="alert" for screen reader announcement
    error &&
      React.createElement(
        'span',
        { id: errorId, className: 'form-field__error', role: 'alert', 'aria-live': 'assertive' },
        error,
      ),
  );
};

export default FormField;
