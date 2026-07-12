# -----------------------------------------------------------------------------
# Elasticsearch / OpenSearch food-item search domain + index template
#
# Declarative IaC only. The index mapping/settings for the 2M+ item fuzzy search
# index live in food-items.index.json and are registered as a composable index
# template at apply time. Encryption at rest, node-to-node encryption, and
# HTTPS-only enforcement are configured (Req 25). No secrets embedded.
# -----------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    elasticstack = {
      source  = "elastic/elasticstack"
      version = ">= 0.11"
    }
  }
}

locals {
  common_tags = merge(
    {
      "app"         = "calorie-cortisol-tool"
      "component"   = "elasticsearch-food-search"
      "environment" = var.environment
    },
    var.tags,
  )

  # Load the food-items index template (settings + mappings) from JSON so the
  # mapping is the single source of truth, reusable by app-side integration.
  food_items_template = jsondecode(file("${path.module}/food-items.index.json"))
}

resource "aws_opensearch_domain" "food_search" {
  domain_name    = var.domain_name
  engine_version = var.engine_version

  cluster_config {
    instance_type          = var.instance_type
    instance_count         = var.instance_count
    zone_awareness_enabled = var.instance_count > 1
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.volume_size_gb
  }

  # Security posture (Req 25): encrypt at rest, encrypt node-to-node, HTTPS only.
  encrypt_at_rest {
    enabled    = true
    kms_key_id = var.kms_key_arn
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-PFS-2023-10"
  }

  tags = local.common_tags
}

# Register the composable index template for food-items-* indices. The mapping
# and analysis settings come directly from food-items.index.json.
resource "elasticstack_elasticsearch_index_template" "food_items" {
  name           = var.index_template_name
  index_patterns = local.food_items_template.index_patterns

  template {
    settings = jsonencode(local.food_items_template.template.settings)
    mappings = jsonencode(local.food_items_template.template.mappings)
  }
}
