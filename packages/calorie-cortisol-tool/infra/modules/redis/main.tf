# -----------------------------------------------------------------------------
# Redis / ElastiCache replication group
#
# Declarative IaC only. Encryption in transit + at rest are enabled; the three
# logical namespaces (sessions, rate-limit, nutrition hot cache) are expressed as
# key-prefix/logical-DB conventions surfaced through outputs and the parameter
# group. No secrets/auth tokens are embedded (auth token is expected to be
# injected from a secret store at apply time, not stored here).
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
      "component"   = "redis-elasticache"
      "environment" = var.environment
    },
    var.tags,
  )
}

resource "aws_elasticache_subnet_group" "this" {
  count      = length(var.subnet_ids) > 0 ? 1 : 0
  name       = "${var.cluster_id}-subnets"
  subnet_ids = var.subnet_ids
  tags       = local.common_tags
}

# Parameter group: maxmemory-policy tuned so the nutrition hot cache evicts by
# LRU-with-TTL rather than erroring when full.
resource "aws_elasticache_parameter_group" "this" {
  name   = "${var.cluster_id}-params"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }

  tags = local.common_tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.cluster_id
  description          = "Sessions, rate-limit counters, and top-50K nutrition hot cache."

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  parameter_group_name = aws_elasticache_parameter_group.this.name
  subnet_group_name    = length(var.subnet_ids) > 0 ? aws_elasticache_subnet_group.this[0].name : null
  security_group_ids   = var.security_group_ids

  # Security posture: encrypt in transit (TLS) and at rest (Req 25.1/25.2).
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn

  tags = local.common_tags
}
