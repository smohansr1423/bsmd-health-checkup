# -----------------------------------------------------------------------------
# Elasticsearch food-item search index — input variables
# 2M+ food item fuzzy search index (Req 7.7).
# -----------------------------------------------------------------------------

variable "domain_name" {
  description = "Name of the managed Elasticsearch/OpenSearch domain."
  type        = string
  default     = "calorie-cortisol-food-search"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod). Tagging only."
  type        = string
  default     = "dev"
}

variable "engine_version" {
  description = "Search engine version."
  type        = string
  default     = "OpenSearch_2.13"
}

variable "instance_type" {
  description = "Data node instance type."
  type        = string
  default     = "r6g.large.search"
}

variable "instance_count" {
  description = "Number of data nodes. Sized for a 2M+ document index."
  type        = number
  default     = 3
}

variable "volume_size_gb" {
  description = "EBS volume size per data node (GB)."
  type        = number
  default     = 100
}

variable "kms_key_arn" {
  description = "KMS key ARN for at-rest encryption. No key material embedded here."
  type        = string
  default     = null
}

variable "index_template_name" {
  description = "Name registered for the food-items composable index template."
  type        = string
  default     = "food-items"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
