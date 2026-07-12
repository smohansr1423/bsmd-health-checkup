# -----------------------------------------------------------------------------
# Root composition outputs — surface store handles for downstream service config.
# -----------------------------------------------------------------------------

output "photo_bucket_arn" {
  description = "ARN of the encrypted/WORM food-photo bucket."
  value       = module.s3_photo_store.bucket_arn
}

output "photo_per_user_access_policy_arn" {
  description = "IAM policy scoping photo access to the caller's per-user prefix."
  value       = module.s3_photo_store.per_user_access_policy_arn
}

output "redis_primary_endpoint" {
  description = "Primary endpoint of the Redis replication group."
  value       = module.redis.primary_endpoint_address
}

output "redis_namespaces" {
  description = "Redis logical namespaces (sessions, rate-limit, nutrition hot cache)."
  value       = module.redis.namespaces
}

output "food_search_endpoint" {
  description = "HTTPS endpoint of the food-item search domain."
  value       = module.elasticsearch.domain_endpoint
}

output "food_search_index_template" {
  description = "Registered composable index template for food-items-* indices."
  value       = module.elasticsearch.index_template_name
}
