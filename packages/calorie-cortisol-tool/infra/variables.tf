# -----------------------------------------------------------------------------
# Root composition variables. KMS key ARNs are injected (from the encryption/
# key-management module, task 3.1); no key material or secrets are stored here.
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Deployment environment (dev, staging, prod)."
  type        = string
  default     = "dev"
}

# --- S3 photo store ------------------------------------------------------------
variable "photo_bucket_name" {
  description = "Globally-unique S3 bucket name for encrypted/WORM food photos."
  type        = string
  default     = "calorie-cortisol-photos"
}

variable "photo_kms_key_arn" {
  description = "KMS key ARN for S3 SSE-KMS (AES-256) encryption of photos."
  type        = string
  default     = null
}

# --- Redis ---------------------------------------------------------------------
variable "redis_cluster_id" {
  description = "ElastiCache replication group identifier."
  type        = string
  default     = "calorie-cortisol-redis"
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the Redis cache subnet group."
  type        = list(string)
  default     = []
}

variable "redis_security_group_ids" {
  description = "Security group IDs for Redis network access control."
  type        = list(string)
  default     = []
}

variable "redis_kms_key_arn" {
  description = "KMS key ARN for Redis at-rest encryption."
  type        = string
  default     = null
}

# --- Elasticsearch -------------------------------------------------------------
variable "food_search_domain_name" {
  description = "Name of the Elasticsearch/OpenSearch food-search domain."
  type        = string
  default     = "calorie-cortisol-food-search"
}

variable "food_search_kms_key_arn" {
  description = "KMS key ARN for search domain at-rest encryption."
  type        = string
  default     = null
}
