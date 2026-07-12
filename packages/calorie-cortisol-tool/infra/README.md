# Data-Store Infrastructure-as-Code

Declarative Terraform configuration for the Calorie & Cortisol Tool's non-relational
data stores. This directory covers **task 2.3** only: S3 (encrypted/WORM), Redis
(ElastiCache), and Elasticsearch index mapping.

> This is configuration-as-code. It provisions nothing on its own, contains no
> secrets, and embeds no key material. KMS key ARNs are injected from the
> encryption/key-management module (task 3.1).

## Layout

```
infra/
├── main.tf              # root composition wiring the three modules
├── variables.tf         # injected inputs (bucket names, KMS ARNs, subnets)
├── outputs.tf           # store handles for downstream service config
└── modules/
    ├── s3-photo-store/   # per-user-prefixed, AES-256 SSE-KMS, WORM Object Lock
    ├── redis/            # sessions / rate-limit / top-50K nutrition namespaces
    └── elasticsearch/    # 2M+ food-item fuzzy search domain + index mapping
        └── food-items.index.json   # authoritative index settings + mappings
```

## Store summary

| Store | Configuration | Requirements |
|---|---|---|
| **S3 photo store** | SSE-KMS AES-256 with per-user customer-managed key (key material stored separately in KMS), Object Lock in `COMPLIANCE` mode (WORM, ~7-year retention), versioning, full public-access block, TLS-only + encrypted-only bucket policy, per-user `users/{user_id}/photos/` prefix enforced by IAM policy | 25.1, 25.6 |
| **Redis / ElastiCache** | Replication group with transit + at-rest encryption; three logical namespaces by key prefix / logical DB: `sess:` (sessions), `rl:` (rate-limit counters), `nut:` (top-50K nutrition hot cache); `volatile-lru` eviction | design data-store mapping |
| **Elasticsearch** | OpenSearch domain (encrypt-at-rest, node-to-node encryption, HTTPS-only) + `food-items` composable index template: 6 shards, edge-ngram index analyzer + synonym-graph search analyzer for typo-tolerant / prefix / synonym fuzzy search, `rank_feature` popularity boosting | 7.7 |

## Namespaces (Redis)

| Namespace | Key prefix | Logical DB | Default TTL | Purpose |
|---|---|---|---|---|
| sessions | `sess:` | 0 | 900s | Authenticated session + refresh-token state |
| rate_limit | `rl:` | 1 | 60s | Per-user/per-IP token-bucket counters |
| nutrition_hot_cache | `nut:` | 2 | 86400s | Top-50K nutrition item hot cache |

## Food-item index mapping

`modules/elasticsearch/food-items.index.json` is the single source of truth for
the 2M+ item search index. It is loaded by the Terraform module to register the
index template and can be reused directly by the Nutrition Lookup service when
it performs `GET /search?q=` (Req 7.7). Fuzzy behaviour comes from:

- **Index analyzer** (`food_name_index`): `standard` tokenizer → lowercase →
  asciifolding → `edge_ngram(2,20)` for prefix / partial matches.
- **Search analyzer** (`food_name_search`): lowercase → asciifolding →
  synonym-graph for query-time synonym expansion.
- **`name.suggest`** (`search_as_you_type`) for autocomplete.
- Query-time `fuzziness: AUTO` (applied by the service) for typo tolerance.

## Validation

```bash
terraform fmt -recursive -check
terraform validate      # requires provider init in a real environment
```

The JSON mapping can be validated independently, e.g. `jq . modules/elasticsearch/food-items.index.json`.
