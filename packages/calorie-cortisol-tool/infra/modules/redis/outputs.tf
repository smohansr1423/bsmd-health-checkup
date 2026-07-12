# -----------------------------------------------------------------------------
# Redis / ElastiCache — outputs
# -----------------------------------------------------------------------------

output "replication_group_id" {
  description = "ID of the ElastiCache replication group."
  value       = aws_elasticache_replication_group.this.id
}

output "primary_endpoint_address" {
  description = "Primary endpoint address of the replication group."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "reader_endpoint_address" {
  description = "Reader endpoint address of the replication group."
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "namespaces" {
  description = "Logical namespace map (key prefixes, logical DB, TTLs) consumed by services."
  value       = var.namespaces
}

output "nutrition_cache_max_entries" {
  description = "Configured maximum entries for the nutrition hot cache."
  value       = var.nutrition_cache_max_entries
}
