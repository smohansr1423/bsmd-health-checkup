/**
 * Insurance Claim interfaces
 */

export interface ClaimLineItem {
  description: string;
  amount: number;
}

export interface InsuranceClaim {
  id: string;
  invoiceId: string;
  seniorId: string;
  policyNumber: string;
  insuranceProvider: string;
  claimedAmount: number;
  lineItems?: ClaimLineItem[];
  approvedAmount?: number;
  status: 'submitted' | 'pending' | 'approved' | 'rejected' | 'failed';
  rejectionReason?: string;
  submissionReference: string;
  submittedAt: Date;
  lastStatusUpdate: Date;
  failureReason?: string;
}
