# Calorie & Cortisol Tool

Local-first, opt-in-cloud personal health companion that fuses nutrition (from
food imagery) and stress-hormone (cortisol) data into a Correlation & Insights
engine. This directory is the product's sub-monorepo within the wider workspace.

## Layout

```
packages/calorie-cortisol-tool/
├── gateway/                     API Gateway (GraphQL + REST webhooks)   [Node/TS]
├── services/
│   ├── food-vision/             Recognition + portion estimation        [Python]
│   ├── nutrition-lookup/        Nutrition calc + food search            [Python]
│   ├── insights-ml/             Correlation, guidance, LLM layer        [Python]
│   ├── cortisol-data/           Lab/wearable/questionnaire ingestion    [Node/TS]
│   ├── notification/            Event-driven push/email/alerts          [Node/TS]
│   └── user-profile/            Onboarding, consent, family, export     [Go]
├── clients/
│   ├── ios/                     Swift/SwiftUI · Core ML · HealthKit
│   ├── android/                 Kotlin/Compose · TFLite · Health Connect
│   ├── pwa/                     React/TS · Service Worker · WebRTC       [Node/TS]
│   └── shared/                  Local-first Data Vault, sync, capture    [Node/TS]
└── shared/                      Shared domain types & API contracts      [Node/TS]
```

## Test toolchains (per design testing strategy)

| Language   | Packages                                                              | PBT library | Runner        |
| ---------- | --------------------------------------------------------------------- | ----------- | ------------- |
| Python     | food-vision, nutrition-lookup, insights-ml                            | Hypothesis  | pytest        |
| Node/TS    | gateway, cortisol-data, notification, clients/pwa, clients/shared, shared | fast-check  | Jest (ts-jest)|
| Go         | user-profile                                                          | gopter      | go test       |
| Swift      | clients/ios                                                           | —           | XCTest        |
| Kotlin     | clients/android                                                       | —           | Gradle/JUnit  |

Property-based tests each implement exactly one design correctness property, run
a minimum of 100 generated iterations, and are tagged
`Feature: calorie-cortisol-tool, Property {number}`.

## Running tests

- Node/TS (all packages): `npm install && npm test` (from this directory)
- Python service: `cd services/<name> && poetry install --no-root && poetry run pytest`
- Go service: `cd services/user-profile && go mod tidy && go test ./...`

CI wiring lives in `.github/workflows/calorie-cortisol-tool.yml`.

## Tooling alignment

ESLint, Prettier, and the base TypeScript compiler options extend the workspace
root configuration (`../../.eslintrc.json`, `../../.prettierrc`, `../../tsconfig.json`).
