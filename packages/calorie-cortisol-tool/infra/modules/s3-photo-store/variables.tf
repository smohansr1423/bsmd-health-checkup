# -----------------------------------------------------------------------------
# S3 Encrypted / WORM Food-Photo Store — input variables
# Requirements: 25.1 (AES-256 at rest, per-user keys stored separately),
#               25.6 (audit metadata retention), food-photo storage (design).
# -----------------------------------------------------------------------------

variable "bucket_name" {
  description = "Globally-unique name of the food-photo bucket."
  type        = string
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod). Used for tagging only."
  type        = string
  default     = "dev"
}

variable "kms_key_arn" {
  description = <<-EOT
    ARN of the customer-managed KMS key used for SSE-KMS (AES-256) encryption of
    photo objects. Per Req 25.1 the key material is managed in KMS, kept separate
    from the object storage. Supply the key produced by the encryption/key-management
    module (task 3.1). No key material or secret is embedded here.
  EOT
  type        = string
}

variable "object_lock_retention_days" {
  description = <<-EOT
    Default WORM retention window (in days) applied to every photo object via
    S3 Object Lock. During this window objects cannot be overwritten or deleted
    (immutability / write-once-read-many). Req 25.6.
  EOT
  type        = number
  default     = 2555 # ~7 years, aligns with the >=6-year audit retention floor
}

variable "object_lock_mode" {
  description = "S3 Object Lock retention mode. COMPLIANCE enforces true WORM (no early deletion, even by root)."
  type        = string
  default     = "COMPLIANCE"

  validation {
    condition     = contains(["COMPLIANCE", "GOVERNANCE"], var.object_lock_mode)
    error_message = "object_lock_mode must be either COMPLIANCE or GOVERNANCE."
  }
}

variable "noncurrent_version_expiration_days" {
  description = "Days after which noncurrent object versions are expired (lifecycle hygiene)."
  type        = number
  default     = 2555
}

variable "user_prefix_template" {
  description = <<-EOT
    Logical key-layout template documenting the per-user prefixing scheme. Every
    object key MUST begin with users/$${user_id}/ so that IAM policies and access
    controls can be scoped per user. This value is informational/for outputs; the
    prefix is enforced at write time by the Food Vision service and by the IAM
    policy generated below.
  EOT
  type        = string
  default     = "users/$${user_id}/photos/"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
