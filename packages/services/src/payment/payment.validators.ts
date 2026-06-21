/**
 * Payment Validators
 * Validation logic for payment details across all supported methods.
 * Validates: Requirements 10.1, 10.2
 */

import type { PaymentDetails, PaymentMethodType } from './payment.types';
import { PaymentValidationError } from './payment.errors';

/**
 * Validates a credit/debit card number (16 digits, numeric only).
 */
export function validateCardNumber(cardNumber: string): void {
  const cleaned = cardNumber.replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(cleaned)) {
    throw new PaymentValidationError(
      'cardNumber',
      'Card number must be exactly 16 digits.'
    );
  }
}

/**
 * Validates card expiry date is in the future.
 */
export function validateCardExpiry(month: number, year: number, now: Date): void {
  if (month < 1 || month > 12) {
    throw new PaymentValidationError(
      'expiryMonth',
      'Expiry month must be between 1 and 12.'
    );
  }

  const expiryDate = new Date(year, month, 0); // Last day of expiry month
  if (expiryDate < now) {
    throw new PaymentValidationError(
      'expiryDate',
      'Card has expired. Expiry date must be in the future.'
    );
  }
}

/**
 * Validates CVV format (3 or 4 digits).
 */
export function validateCVV(cvv: string): void {
  if (!/^\d{3,4}$/.test(cvv)) {
    throw new PaymentValidationError(
      'cvv',
      'CVV must be 3 or 4 digits.'
    );
  }
}

/**
 * Validates cardholder name is not empty.
 */
export function validateCardHolderName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new PaymentValidationError(
      'cardHolderName',
      'Cardholder name is required.'
    );
  }
}

/**
 * Validates bank transfer details.
 */
export function validateBankTransferDetails(details: PaymentDetails): void {
  if (!details.accountNumber || details.accountNumber.trim().length === 0) {
    throw new PaymentValidationError(
      'accountNumber',
      'Account number is required for bank transfer.'
    );
  }
  if (!details.routingNumber || details.routingNumber.trim().length === 0) {
    throw new PaymentValidationError(
      'routingNumber',
      'Routing number is required for bank transfer.'
    );
  }
  if (!details.bankName || details.bankName.trim().length === 0) {
    throw new PaymentValidationError(
      'bankName',
      'Bank name is required for bank transfer.'
    );
  }
}

/**
 * Validates digital wallet details.
 */
export function validateDigitalWalletDetails(details: PaymentDetails): void {
  if (!details.walletId || details.walletId.trim().length === 0) {
    throw new PaymentValidationError(
      'walletId',
      'Wallet ID is required for digital wallet payment.'
    );
  }
  if (!details.walletProvider || details.walletProvider.trim().length === 0) {
    throw new PaymentValidationError(
      'walletProvider',
      'Wallet provider is required for digital wallet payment.'
    );
  }
}

/**
 * Validates payment details based on the payment method.
 *
 * Requirement 10.2: Validate payment details (card format, expiry, required fields).
 */
export function validatePaymentDetails(
  method: PaymentMethodType,
  details: PaymentDetails,
  now: Date
): void {
  switch (method) {
    case 'credit_card':
    case 'debit_card':
      if (!details.cardNumber) {
        throw new PaymentValidationError('cardNumber', 'Card number is required.');
      }
      validateCardNumber(details.cardNumber);

      if (!details.cardHolderName) {
        throw new PaymentValidationError('cardHolderName', 'Cardholder name is required.');
      }
      validateCardHolderName(details.cardHolderName);

      if (details.expiryMonth === undefined || details.expiryYear === undefined) {
        throw new PaymentValidationError('expiryDate', 'Card expiry month and year are required.');
      }
      validateCardExpiry(details.expiryMonth, details.expiryYear, now);

      if (!details.cvv) {
        throw new PaymentValidationError('cvv', 'CVV is required.');
      }
      validateCVV(details.cvv);
      break;

    case 'bank_transfer':
      validateBankTransferDetails(details);
      break;

    case 'digital_wallet':
      validateDigitalWalletDetails(details);
      break;

    default:
      throw new PaymentValidationError('method', `Unsupported payment method: ${method}`);
  }
}

/**
 * Validates payment amount is positive.
 */
export function validatePaymentAmount(amount: number): void {
  if (amount <= 0) {
    throw new PaymentValidationError('amount', 'Payment amount must be greater than zero.');
  }
}
