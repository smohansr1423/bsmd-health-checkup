# -----------------------------------------------------------------------------
# S3 Photo Store — outputs
# -----------------------------------------------------------------------------

output "bucket_id" {
  description = "Name/ID of the food-photo bucket."
  value       = aws_s3_bucket.photos.id
}

output "bucket_arn" {
  description = "ARN of the food-photo bucket."
  value       = aws_s3_bucket.photos.arn
}

output "per_user_access_policy_arn" {
  description = "ARN of the IAM policy that scopes access to the caller's own per-user prefix."
  value       = aws_iam_policy.per_user_access.arn
}

output "user_prefix_template" {
  description = "The per-user object key prefix template every write must honor."
  value       = var.user_prefix_template
}

output "object_lock_mode" {
  description = "Active WORM (Object Lock) retention mode."
  value       = var.object_lock_mode
}

output "object_lock_retention_days" {
  description = "Active WORM retention window in days."
  value       = var.object_lock_retention_days
}
