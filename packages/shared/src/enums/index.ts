/**
 * Enums for the Senior Citizen Health Checkup System
 */

export enum Gender {
  Male = 'male',
  Female = 'female',
  Other = 'other',
}

export enum SupportedLanguage {
  English = 'en',
  Hindi = 'hi',
  Spanish = 'es',
  Chinese = 'zh',
  Arabic = 'ar',
  French = 'fr',
  Portuguese = 'pt',
  Bengali = 'bn',
  Japanese = 'ja',
  German = 'de',
}

export enum RiskCategory {
  Normal = 'Normal',
  Borderline = 'Borderline',
  Critical = 'Critical',
  Uncategorized = 'Uncategorized',
}

export enum AgeGroup {
  SixtyToSixtyNine = '60-69',
  SeventyToSeventyNine = '70-79',
  EightyToEightyNine = '80-89',
  NinetyPlus = '90+',
}

export enum TestCategory {
  Cardiac = 'cardiac',
  Vision = 'vision',
  Hearing = 'hearing',
  Musculoskeletal = 'musculoskeletal',
  Blood = 'blood',
  Urine = 'urine',
  Imaging = 'imaging',
  Cognitive = 'cognitive',
  Endocrine = 'endocrine',
  OrganFunction = 'organ_function',
}

export enum PaymentMethod {
  CreditCard = 'credit_card',
  DebitCard = 'debit_card',
  BankTransfer = 'bank_transfer',
  DigitalWallet = 'digital_wallet',
}

export enum DeliveryChannel {
  SMS = 'sms',
  Email = 'email',
  Push = 'push',
  PhoneCall = 'phone_call',
}

export enum NotificationType {
  AppointmentConfirmation = 'appointment_confirmation',
  AppointmentReminder = 'appointment_reminder',
  CriticalAlert = 'critical_alert',
  ReportAvailable = 'report_available',
  FollowUpReminder = 'follow_up_reminder',
  PaymentConfirmation = 'payment_confirmation',
  Escalation = 'escalation',
}

export enum EscalationLevel {
  Physician = 'physician',
  DepartmentHead = 'department_head',
  FacilityAdministrator = 'facility_administrator',
}
