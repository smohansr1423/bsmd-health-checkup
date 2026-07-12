# -----------------------------------------------------------------------------
# Calorie & Cortisol Tool — data-store infrastructure composition
#
# Wires the S3 photo store, Redis/ElastiCache, and Elasticsearch food-search
# modules for task 2.3. This is declarative configuration-as-code only:
#   * no real cloud resources are provisioned by reading this file
#   * no secrets or key material are embedded (KMS key ARNs are passed in)
#
# Scope is strictly store configuration + the food-item index mapping. Service
# endpoints and business logic are intentionally out of scope here.
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

# --- S3: per-user-prefixed, AES-256 encrypted, WORM photo store (Req 25.1/25.6)
module "s3_photo_store" {
  source = "./modules/s3-photo-store"

  bucket_name = var.photo_bucket_name
  environment = var.environment
  kms_key_arn = var.photo_kms_key_arn
}

# --- Redis: sessions, rate-limit counters, top-50K nutrition hot cache --------
module "redis" {
  source = "./modules/redis"

  cluster_id         = var.redis_cluster_id
  environment        = var.environment
  subnet_ids         = var.private_subnet_ids
  security_group_ids = var.redis_security_group_ids
  kms_key_arn        = var.redis_kms_key_arn
}

# --- Elasticsearch: 2M+ food item fuzzy search index mapping (Req 7.7) --------
module "elasticsearch" {
  source = "./modules/elasticsearch"

  domain_name = var.food_search_domain_name
  environment = var.environment
  kms_key_arn = var.food_search_kms_key_arn
}
