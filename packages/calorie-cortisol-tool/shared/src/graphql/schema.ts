/**
 * GraphQL schema (SDL) for the client-facing API.
 *
 * The gateway exposes these types as the primary client API (aggregated reads
 * for dashboards, mutations for corrections/consent). This SDL is the single
 * source of truth; resolvers are implemented in later tasks.
 *
 * Covers: Meal, NutritionResult, CortisolReading, DiurnalProfile, Insight,
 * Profile, FamilyMember, ConsentState (design: API Gateway).
 */
export const GRAPHQL_SCHEMA_SDL = /* GraphQL */ `
  scalar DateTime

  enum NutrientUnit {
    kcal
    g
    mg
  }

  enum MealSource {
    photo
    barcode
    voice
    menuOCR
    textSearch
    manual
  }

  enum SyncStatus {
    local
    pending
    synced
    conflict
  }

  enum ReferenceObject {
    plate
    hand
    utensil
  }

  enum CortisolSource {
    lab
    patch
    wearableProxy
    questionnaireProxy
  }

  enum TimeOfDayBucket {
    morning
    noon
    afternoon
    evening
  }

  enum Classification {
    below
    normal
    above
  }

  enum BurdenTier {
    Low
    Moderate
    Elevated
    High
  }

  enum ApprovalStatus {
    approved
    draft
    pending
    revoked
  }

  enum FamilyRole {
    admin
    member
  }

  type BoundingBox {
    x: Float!
    y: Float!
    width: Float!
    height: Float!
  }

  type FoodItem {
    id: ID!
    label: String!
    "0..100"
    confidence: Float!
    bbox: BoundingBox
  }

  type NutrientValue {
    value: Float!
    unit: NutrientUnit!
    "lower <= value <= upper"
    lower: Float!
    upper: Float!
    available: Boolean!
  }

  type PortionEstimate {
    volumeMl: Float!
    errorPct: Float!
    scaled: Boolean!
    referenceObject: ReferenceObject
  }

  type MealItem {
    foodItem: FoodItem!
    "0.25..3.0 step 0.25"
    portionMultiplier: Float!
    nutrition: [NamedNutrient!]!
  }

  type NamedNutrient {
    name: String!
    value: NutrientValue!
  }

  "Aggregated nutrition totals for a meal or a nutrition lookup result."
  type NutritionResult {
    calories: NutrientValue!
    protein: NutrientValue!
    carbs: NutrientValue!
    fat: NutrientValue!
    secondary: [NamedNutrient!]!
    micronutrients: [NamedNutrient!]
  }

  type Meal {
    id: ID!
    userId: ID!
    loggedAt: DateTime!
    items: [MealItem!]!
    totals: NutritionResult!
    source: MealSource!
    syncStatus: SyncStatus!
  }

  type ReferenceContext {
    ageBand: String!
    sex: String!
    refLower: Float!
    refUpper: Float!
    classification: Classification!
  }

  type CortisolReading {
    id: ID!
    userId: ID!
    measuredAt: DateTime!
    valueNmolL: Float!
    source: CortisolSource!
    sourceId: String
    timeOfDayBucket: TimeOfDayBucket!
    contextualized: ReferenceContext
    valid: Boolean!
  }

  "A day's diurnal cortisol curve plus reference bands (Req 11, 12)."
  type DiurnalProfile {
    userId: ID!
    date: DateTime!
    readings: [CortisolReading!]!
    carIncreasePct: Float
    flattened: Boolean
  }

  type Insight {
    id: ID!
    templateId: String!
    approvalStatus: ApprovalStatus!
    disclaimerRendered: Boolean!
    rankScore: Float!
    body: String
    disclaimer: String
  }

  type ConsentCategory {
    name: String!
    optedIn: Boolean!
  }

  type ConsentState {
    userId: ID!
    categories: [ConsentCategory!]!
    healthDataConsent: Boolean!
    updatedAt: DateTime!
  }

  type FamilyMember {
    id: ID!
    role: FamilyRole!
  }

  type Profile {
    userId: ID!
    displayName: String
    familyMembers: [FamilyMember!]!
    consent: ConsentState!
  }

  input ConsentCategoryInput {
    name: String!
    optedIn: Boolean!
  }

  input PortionCorrectionInput {
    itemId: ID!
    multiplier: Float!
  }

  type Query {
    meal(id: ID!): Meal
    meals(userId: ID!, from: DateTime, to: DateTime): [Meal!]!
    cortisolTrend(userId: ID!, range: Int!): [CortisolReading!]!
    diurnalProfile(userId: ID!, date: DateTime!): DiurnalProfile
    insights(userId: ID!): [Insight!]!
    profile(userId: ID!): Profile
    consentState(userId: ID!): ConsentState
  }

  type Mutation {
    correctMealPortion(mealId: ID!, correction: PortionCorrectionInput!): Meal!
    addMealItemByText(mealId: ID!, query: String!): Meal!
    addMealItemByBarcode(mealId: ID!, barcode: String!): Meal!
    deleteMealItem(mealId: ID!, itemId: ID!): Meal!
    updateConsent(userId: ID!, categories: [ConsentCategoryInput!]!): ConsentState!
  }
`;
