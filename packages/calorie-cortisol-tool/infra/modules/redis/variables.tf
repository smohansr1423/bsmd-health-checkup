# -----------------------------------------------------------------------------
# Redis / ElastiCache — input variables
# Provides sessions, rate-limit counters, and the top-50K nutrition hot cache.
# Design: "Redis (ElastiCache) | Sessions, rate-limit counters, top-50K nutrition cache"
# -----------------------------------------------------------------------------

variable "cluster_id" {
  description = "Identifier for the ElastiCache (Redis) replication group."
  type        = string
  default     = "calorie-cortisol-redis"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod). Tagging only."
  type        = string
  default     = "dev"
}

variable "node_type" {
  description = "ElastiCache node instance type."
  type        = string
  default     = "cache.r6g.large"
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"
}

variable "num_cache_clusters" {
  description = "Number of nodes (primary + replicas) in the replication group."
  type        = number
  default     = 2
}

variable "subnet_ids" {
  description = "Private subnet IDs for the cache subnet group."
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "Security group IDs controlling network access to the cache."
  type        = list(string)
  default     = []
}

variable "kms_key_arn" {
  description = "KMS key ARN for at-rest encryption. No key material is embedded here."
  type        = string
  default     = null
}

variable "namespaces" {
  description = <<-EOT
    Logical key-namespace map. Redis has no native namespaces, so isolation is by
    key prefix + logical DB index. These prefixes are consumed by the Node/TS and
    Python services to keep sessions, rate-limit counters, and the nutrition hot
    cache from colliding.
  EOT
  type = map(object({
    key_prefix         = string
    logical_db         = number
    default_ttl_seconds = number
    description        = string
  }))
  default = {
    sessions = {
      key_prefix          = "sess:"
      logical_db          = 0
      default_ttl_seconds = 900 # 15-min JWT/session window (Req 18/25)
      description         = "Authenticated session + refresh-token state."
    }
    rate_limit = {
      key_prefix          = "rl:"
      logical_db          = 1
      default_ttl_seconds = 60 # token-bucket refill window (Req 23)
      description         = "Per-user/per-IP token-bucket rate-limit counters."
    }
    nutrition_hot_cache = {
      key_prefix          = "nut:"
      logical_db          = 2
      default_ttl_seconds = 86400 # 24h hot cache for top-50K items (Req 7)
      description         = "Top-50K nutrition item hot cache."
    }
  }
}

variable "nutrition_cache_max_entries" {
  description = "Target maximum entries for the nutrition hot cache (top-50K items)."
  type        = number
  default     = 50000
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
