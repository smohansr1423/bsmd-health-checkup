# -----------------------------------------------------------------------------
# Elasticsearch food-item search — outputs
# -----------------------------------------------------------------------------

output "domain_name" {
  description = "Name of the search domain."
  value       = aws_opensearch_domain.food_search.domain_name
}

output "domain_endpoint" {
  description = "HTTPS endpoint of the search domain."
  value       = aws_opensearch_domain.food_search.endpoint
}

output "index_template_name" {
  description = "Registered composable index template name for food-items-* indices."
  value       = elasticstack_elasticsearch_index_template.food_items.name
}

output "index_patterns" {
  description = "Index patterns covered by the food-items template."
  value       = local.food_items_template.index_patterns
}
