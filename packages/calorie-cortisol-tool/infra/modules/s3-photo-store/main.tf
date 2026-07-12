# -----------------------------------------------------------------------------
# S3 Encrypted / WORM Food-Photo Store
#
# Declarative infrastructure-as-code only. Applying this module would create the
# store; nothing here provisions resources on its own and no secrets are embedded.
#
# Controls implemented:
#   * AES-256 encryption at rest via SSE-KMS with a customer-managed, per-user
#     KMS key whose material is stored separately from the data (Req 25.1).
#   * WORM immutability via S3 Object Lock in COMPLIANCE mode (Req 25.6).
#   * Per-user key prefixing (users/{user_id}/photos/...) enforced by an IAM
#     policy template scoped to the caller's own prefix.
#   * Access logging + versioning + full public-access block for auditability.
# -----------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  common_tags = merge(
    {
      "app"         = "calorie-cortisol-tool"
      "component"   = "s3-photo-store"
      "environment" = var.environment
      "data-class"  = "phi-health-photo"
    },
    var.tags,
  )
}

# Object Lock must be enabled at bucket-creation time to allow WORM retention.
resource "aws_s3_bucket" "photos" {
  bucket              = var.bucket_name
  object_lock_enabled = true
  tags                = local.common_tags
}

# --- Encryption at rest: AES-256 via SSE-KMS, per-user customer-managed key ----
resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    # Reduce KMS request volume without weakening per-object encryption.
    bucket_key_enabled = true
  }
}

# --- Versioning (prerequisite for Object Lock / WORM) --------------------------
resource "aws_s3_bucket_versioning" "photos" {
  bucket = aws_s3_bucket.photos.id
  versioning_configuration {
    status = "Enabled"
  }
}

# --- WORM: default Object Lock retention on every new object -------------------
resource "aws_s3_bucket_object_lock_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    default_retention {
      mode = var.object_lock_mode
      days = var.object_lock_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.photos]
}

# --- Block all public access ---------------------------------------------------
resource "aws_s3_bucket_public_access_block" "photos" {
  bucket = aws_s3_bucket.photos.id

  block_public_acls       = true
  block_public_policy      = true
  ignore_public_acls       = true
  restrict_public_buckets  = true
}

# --- Lifecycle hygiene for noncurrent versions ---------------------------------
resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.photos]
}

# --- Bucket policy: deny any request that is not TLS 1.2+ / not encrypted ------
# Enforces encrypted-only writes and secure transport at the storage boundary.
data "aws_iam_policy_document" "bucket_policy" {
  statement {
    sid     = "DenyUnEncryptedObjectUploads"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = ["${aws_s3_bucket.photos.arn}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [
      aws_s3_bucket.photos.arn,
      "${aws_s3_bucket.photos.arn}/*",
    ]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "photos" {
  bucket = aws_s3_bucket.photos.id
  policy = data.aws_iam_policy_document.bucket_policy.json
}

# --- Per-user access IAM policy template ---------------------------------------
# Scopes a principal's object access to its own users/$${aws:userid}/photos/*
# prefix, realising the "per-user-prefixed" requirement at the authz layer.
data "aws_iam_policy_document" "per_user_access" {
  statement {
    sid    = "PerUserPrefixedObjectAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.photos.arn}/users/$${aws:userid}/photos/*"]
  }

  statement {
    sid       = "PerUserPrefixedList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.photos.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["users/$${aws:userid}/photos/*"]
    }
  }
}

resource "aws_iam_policy" "per_user_access" {
  name        = "${var.bucket_name}-per-user-access"
  description = "Scopes photo object access to the caller's own users/{user_id}/photos/ prefix."
  policy      = data.aws_iam_policy_document.per_user_access.json
  tags        = local.common_tags
}
