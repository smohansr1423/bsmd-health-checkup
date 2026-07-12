# Requirements Document

## Introduction

The Calorie & Cortisol Tool is a dual-function personal health companion delivered as a mobile application. It combines two tightly integrated modules — a Calorie & Macro Estimation Module that estimates nutritional content from food photos and other inputs, and a Cortisol Measurement & Guidance Module that ingests at-home lab tests, wearable data, and validated questionnaires to track stress-hormone burden — plus a Correlation & Insights Engine that fuses the two data streams to surface patterns and actionable, evidence-based guidance.

This document captures the full product vision described in PRD v1.0 as EARS-format requirements. The v1.0 release is framed as a general-wellness product with no diagnostic claims; all health insights carry wellness disclaimers, and clinical thresholds trigger referrals to licensed professionals rather than automated diagnoses. Requirements are grouped by capability area: food estimation, cortisol measurement, correlation, account and profile, non-functional qualities, and regulatory compliance.

Target personas referenced in user stories:
- **Marcus** — a busy professional who wants fast, low-friction meal logging.
- **Priya** — a fitness enthusiast who wants precise macros and correlation with recovery metrics.
- **Jennifer** — a health-anxious parent who manages a family account.
- **Dr. Robert's patient** — a clinically-monitored user who imports lab results and shares reports with a physician.

## Glossary

- **System**: The complete Calorie & Cortisol Tool application, including on-device components and backend services.
- **Food_Estimation_Module**: The subsystem responsible for capturing food imagery and other inputs, recognizing food items, estimating portion size, and computing nutritional breakdowns.
- **Cortisol_Module**: The subsystem responsible for ingesting cortisol measurements from lab kits, wearables, and questionnaires, and for tracking diurnal patterns and guidance.
- **Correlation_Engine**: The subsystem that aligns food and cortisol data by timestamp and produces cross-modal insights, alerts, and digests.
- **Account_Module**: The subsystem responsible for onboarding, authentication, profiles, family accounts, consent, data export, and account deletion.
- **Camera_Capture**: The component that captures single-image, multi-angle, gallery, and video-frame food inputs.
- **Food_Recognizer**: The AI component that classifies food items from imagery.
- **Portion_Estimator**: The component that estimates food volume and portion size from imagery.
- **Nutrition_Calculator**: The component that maps recognized items and portions to nutritional values.
- **Correction_UI**: The user interface allowing users to manually correct recognized items, portions, and nutrition.
- **Personalization_Model**: The per-user model that improves recognition and estimation accuracy from user corrections and history over time.
- **Lab_Integration**: The component that manages at-home test-kit ordering, sample linkage, and certified-lab result ingestion.
- **Wearable_Integration**: The component that syncs cortisol-proxy and physiological data from wearables and health platforms.
- **Questionnaire_Engine**: The component that administers validated questionnaires and maps scores to a cortisol burden tier.
- **Diurnal_Tracker**: The component that tracks the cortisol daily rhythm, including the Cortisol Awakening Response.
- **Guidance_Engine**: The component that presents evidence-based recommendation cards and professional-referral triggers.
- **Data_Vault**: The privacy-first local storage layer holding user health data on-device by default.
- **CAR (Cortisol Awakening Response)**: The natural rise in cortisol occurring within roughly 30–45 minutes after waking; measured from a sample at waking and a second sample ~30 minutes later.
- **Diurnal Rhythm**: The natural 24-hour cycle of cortisol, typically highest in the morning and lowest at night.
- **Cortisol Burden Tier**: A non-clinical categorization of estimated stress-hormone load into Low, Moderate, Elevated, or High.
- **MAPE (Mean Absolute Percentage Error)**: The accuracy metric for calorie estimation, expressing average absolute error as a percentage of the true value.
- **Proxy Estimation**: Deriving an estimate of cortisol burden from indirect signals (questionnaires or wearable metrics) rather than direct hormone measurement.
- **SaMD (Software as a Medical Device)**: Software intended for medical purposes; v1.0 is intentionally scoped as general-wellness and NOT SaMD.
- **PHI (Protected Health Information)**: Individually identifiable health information subject to HIPAA safeguards.
- **FHIR (Fast Healthcare Interoperability Resources)**: The HL7 standard (R4) for exchanging electronic health records.
- **HL7**: Health Level Seven, a set of standards for transfer of clinical and administrative health data.
- **CLIA (Clinical Laboratory Improvement Amendments)**: US federal certification standard for clinical laboratories; CAP is an accompanying accreditation.
- **CAR Window**: The time constraint requiring the first waking sample within 30 minutes of waking and a second sample 30 minutes later.
- **PSS-10 / GAD-7 / PSQI**: Validated self-report questionnaires (Perceived Stress Scale, Generalized Anxiety Disorder scale, Pittsburgh Sleep Quality Index) used for proxy estimation.
- **BAA (Business Associate Agreement)**: A HIPAA-required contract between a covered entity and a service provider handling PHI.

## Requirements

### Requirement 1: Food Photo Capture

**User Story:** As Marcus, a busy professional, I want to capture my meal quickly through my phone camera, so that I can log food with minimal effort.

#### Acceptance Criteria

1. WHEN the user captures a single food image over a 4G connection with a sustained downlink bandwidth of at least 5 Mbps, THE Food_Estimation_Module SHALL return an initial recognition result within 3 seconds.
2. IF the Food_Estimation_Module does not return a recognition result within 3 seconds, or the recognition request fails, THEN THE Food_Estimation_Module SHALL return an error indication that recognition was unsuccessful and SHALL retain the captured image for retry without requiring recapture.
3. WHERE the user selects the multi-angle capture flow, THE Camera_Capture SHALL guide the user through 3 sequential shots at top (0 degrees from vertical), 45-degree, and side (90 degrees from vertical) angles, each within a tolerance of plus or minus 10 degrees.
4. WHEN all 3 multi-angle shots are captured, THE Camera_Capture SHALL pass all 3 images to the Portion_Estimator for volume reconstruction.
5. IF the user exits the multi-angle capture flow before all 3 shots are captured, THEN THE Camera_Capture SHALL discard the partial image set and SHALL NOT submit any image for volume reconstruction.
6. WHEN the user selects an existing photo from the device gallery that is in a supported image format and is 20 MB or smaller, THE Camera_Capture SHALL accept the image and submit it for recognition.
7. IF the user selects a gallery photo or video file that is in an unsupported format or exceeds 20 MB, THEN THE Camera_Capture SHALL reject the file and return an error indication that the file is not accepted, without submitting it for recognition.
8. WHEN the user submits a recorded video of 60 seconds or shorter, THE Camera_Capture SHALL extract the single frame with the highest sharpness score among sampled frames and submit that frame for recognition.
9. WHILE ambient light is below 50 lux, THE Camera_Capture SHALL apply on-device image enhancement before submitting the image for recognition.

### Requirement 2: AI Food Recognition

**User Story:** As Priya, a fitness enthusiast, I want the app to accurately identify the foods on my plate, so that my nutrition tracking is trustworthy.

#### Acceptance Criteria

1. THE Food_Recognizer SHALL classify food items across at least 2,000 food categories.
2. WHEN a single image contains multiple distinct food items, THE Food_Recognizer SHALL detect each item separately, up to a maximum of 20 items per image, and return a per-item confidence score expressed as a percentage from 0 to 100 for each detected item.
3. IF a detected item has a confidence score below 70 percent, THEN THE Food_Recognizer SHALL present a confirmation prompt listing the top 3 candidate items instead of automatically classifying the item.
4. WHERE the meal is identified as a restaurant dish, THE Food_Recognizer SHALL use menu OCR and point-of-sale data to identify the dish.
5. IF the meal is identified as a restaurant dish but menu OCR and point-of-sale data are unavailable, THEN THE Food_Recognizer SHALL fall back to standard image classification and return each identified item with its associated confidence score.
6. WHEN recognition completes, THE Food_Recognizer SHALL return each identified item with its associated confidence score within 5 seconds of image submission.
7. IF no food item is detected with a confidence score of at least 70 percent, THEN THE Food_Recognizer SHALL return a result indicating that no food was recognized and prompt the user to retake the image or enter the food manually, while retaining the submitted image for the current session.

### Requirement 3: Portion Size Estimation

**User Story:** As Priya, I want the app to estimate how much food is on my plate, so that my calorie and macro totals reflect the actual amount I eat.

#### Acceptance Criteria

1. WHEN a single-angle image is submitted, THE Portion_Estimator SHALL estimate food volume using monocular depth estimation and return a volume estimate whose error is within plus or minus 15 percent of ground-truth volume, within 5 seconds of submission.
2. WHEN a multi-angle 3-shot capture is submitted, THE Portion_Estimator SHALL estimate food volume and return a volume estimate whose error is within plus or minus 8 percent of ground-truth volume, within 8 seconds of submission.
3. WHEN an image is processed, THE Portion_Estimator SHALL detect available reference objects (plate, hand, or utensil) and use the detected reference object to scale the volume estimate.
4. IF no reference object (plate, hand, or utensil) is detected in the submitted image, THEN THE Portion_Estimator SHALL return the volume estimate flagged as unscaled and provide an indication that portion accuracy is reduced, without discarding the estimate.
5. IF the submitted image cannot be processed because no food region is detected or image resolution is below 640 by 480 pixels, THEN THE Portion_Estimator SHALL reject the submission, return an error indication describing the reason, and retain no partial estimate.
6. WHEN a user calibrates a personal plate, THE Portion_Estimator SHALL persist the plate calibration for that user and apply the stored calibration as the reference scale for all subsequent estimations for that user until the calibration is changed or removed.
7. IF persisting a plate calibration fails, THEN THE Portion_Estimator SHALL return an error indication that calibration was not saved and SHALL continue to use the previously stored calibration, or no calibration if none existed.

### Requirement 4: Nutritional Breakdown

**User Story:** As Priya, I want a detailed nutritional breakdown of my meal, so that I can manage my macros and secondary nutrients.

#### Acceptance Criteria

1. WHEN recognition and portion estimation complete, THE Nutrition_Calculator SHALL display primary macros consisting of calories in kilocalories, and protein, carbohydrates, and fat each in grams to one decimal place.
2. WHEN recognition and portion estimation complete, THE Nutrition_Calculator SHALL display secondary nutrients consisting of fiber in grams, sugar in grams, sodium in milligrams, saturated fat in grams, and cholesterol in milligrams, each to one decimal place.
3. WHERE the user enables the micronutrient overlay AND at least one micronutrient value is available for the recognized meal, THE Nutrition_Calculator SHALL display each available micronutrient with its value and unit.
4. WHERE the user enables the micronutrient overlay AND no micronutrient value is available for the recognized meal, THE Nutrition_Calculator SHALL display an indication that no micronutrient data is available.
5. WHEN a nutritional value is displayed, THE Nutrition_Calculator SHALL present that value with a confidence range expressed as a lower bound and an upper bound in the same unit as the value, where lower bound is less than or equal to the value and value is less than or equal to upper bound.
6. IF a primary macro or secondary nutrient value cannot be calculated for the recognized meal, THEN THE Nutrition_Calculator SHALL display an indication that the value is unavailable for that nutrient and SHALL display all remaining calculable values.

### Requirement 5: Manual Correction of Food Entries

**User Story:** As Marcus, I want to quickly correct a mis-identified item or portion, so that my log stays accurate without slowing me down.

#### Acceptance Criteria

1. WHEN the user adjusts the portion slider, THE Correction_UI SHALL allow portion multipliers from 0.25x to 3x in increments of 0.25x and SHALL recompute the selected item's nutritional values and the meal's nutritional totals within 1 second of the adjustment.
2. WHEN the user swaps a recognized ingredient for a different item, THE Correction_UI SHALL replace the item and recompute the meal's nutritional totals within 1 second of the swap.
3. WHEN the user adds a missed item, THE Correction_UI SHALL allow the user to add the item by text search or barcode scan and SHALL recompute the meal's nutritional totals within 1 second of the item being added.
4. WHEN the user deletes a false-positive item, THE Correction_UI SHALL remove the item from the meal and recompute the meal's nutritional totals within 1 second of the deletion.
5. WHEN the user submits any correction, THE System SHALL record the correction as training input for the Personalization_Model.
6. IF a text search or barcode scan returns no matching item, THEN THE Correction_UI SHALL display an error indication that no match was found and SHALL leave the meal and its nutritional totals unchanged.
7. IF the deleted item is the last remaining item in the meal, THEN THE Correction_UI SHALL remove the item and set the meal's nutritional totals to zero.
8. IF recording a correction as training input for the Personalization_Model fails, THEN THE System SHALL retain the applied correction in the user's food log and SHALL queue the correction for retry.

### Requirement 6: Meal History and Dashboard

**User Story:** As Priya, I want to review my meal history and trends, so that I can understand my eating patterns over time.

#### Acceptance Criteria

1. WHEN the user opens the daily view for a selected day, THE Food_Estimation_Module SHALL display within 3 seconds a daily summary showing total calories and the total grams of each macronutrient (protein, carbohydrates, and fat) aggregated from all meals logged for that day.
2. IF the user opens the daily view for a day that has no logged meals, THEN THE Food_Estimation_Module SHALL display the daily summary with total calories and each macronutrient total set to zero and an indication that no meals were logged for that day.
3. WHEN the user opens the weekly view for a selected 7-day period, THE Food_Estimation_Module SHALL display within 3 seconds the aggregated total calories and total grams of each macronutrient (protein, carbohydrates, and fat) summed across all meals logged within that period, including days with no logged meals counted as zero.
4. THE Food_Estimation_Module SHALL calculate the consecutive-day logging streak as the number of unbroken calendar days, ending on the current day, on which at least one meal was logged, and SHALL reset the streak count to zero when a calendar day passes with no meal logged.
5. WHEN the user opens the dashboard, THE Food_Estimation_Module SHALL display the current consecutive-day logging streak count as a whole number between 0 and 3650.
6. WHEN the user opens the insights view and at least 7 distinct calendar days each containing at least one logged meal exist within the preceding 30 days, THE Food_Estimation_Module SHALL display meal pattern recognition insights derived from the logged history.
7. IF the user opens the insights view and fewer than 7 distinct calendar days with at least one logged meal exist within the preceding 30 days, THEN THE Food_Estimation_Module SHALL display an indication that insufficient meal history exists to generate insights, stating the number of additional logging days required.

### Requirement 7: Supplementary Food Input Methods

**User Story:** As Marcus, I want alternative ways to log food when a photo is not practical, so that I can still record every meal.

#### Acceptance Criteria

1. WHEN the user scans a product barcode and the barcode matches a nutritional database record, THE Food_Estimation_Module SHALL retrieve the corresponding nutritional information and create a logged meal entry within 5 seconds.
2. IF the user scans a product barcode that matches no nutritional database record within 5 seconds, THEN THE Food_Estimation_Module SHALL retain any prior entry state, display a message indicating the product was not found, and offer the text search input method as a fallback.
3. WHEN the user logs a meal by voice with a spoken input of up to 60 seconds in duration, THE Food_Estimation_Module SHALL transcribe the spoken input and create a corresponding meal entry populated with the transcribed text within 10 seconds.
4. IF voice transcription fails or produces no recognizable text, THEN THE Food_Estimation_Module SHALL create no meal entry, display a message indicating transcription was unsuccessful, and prompt the user to retry or select an alternative input method.
5. WHEN the user scans a restaurant menu, THE Food_Estimation_Module SHALL use OCR to extract menu items and present each extracted item as a selectable option available for logging within 10 seconds.
6. IF OCR extracts no menu items from the scanned image, THEN THE Food_Estimation_Module SHALL retain the current state, display a message indicating no items were recognized, and offer the text search input method as a fallback.
7. WHERE no other input method succeeds, THE Food_Estimation_Module SHALL allow the user to add a food item by entering a text search query of 1 to 100 characters and SHALL return matching food items for selection within 5 seconds.
8. IF a text search query returns no matching food items, THEN THE Food_Estimation_Module SHALL display a message indicating no matches were found and SHALL allow the user to revise the query or create a manual food entry.

### Requirement 8: At-Home Cortisol Test Kit Integration

**User Story:** As Dr. Robert's patient, I want to order and use an at-home cortisol test kit, so that I can get lab-quality results without a clinic visit.

#### Acceptance Criteria

1. WHEN the user submits a test kit order, THE Lab_Integration SHALL create an order record, initiate shipment through a CLIA/CAP-certified lab partner within 60 seconds, and return an order confirmation containing a unique order identifier.
2. WHEN the user scans the kit QR code, THE Lab_Integration SHALL link the physical sample to the user's account and display a confirmation identifying the linked kit.
3. WHERE the diurnal protocol is used, THE Lab_Integration SHALL collect four samples: a morning CAR sample within 30 minutes of waking, a noon sample between 11:00 and 13:00, an afternoon sample between 15:00 and 17:00, and an evening sample between 22:00 and 00:00 (local time).
4. WHEN the certified lab publishes results, THE Lab_Integration SHALL ingest the results via HL7 or JSON within 24 to 72 hours of publication without requiring manual data entry.
5. WHEN results are ingested and the user's age and sex are available, THE Cortisol_Module SHALL contextualize each result against reference ranges appropriate to the user's age, sex, and time-of-day of collection.
6. IF the CLIA/CAP-certified lab partner is unavailable or rejects the order, THEN THE Lab_Integration SHALL retain the order in a pending state, apply no charge to the user, and display an error indicating order creation failed and that no charge was made.
7. IF the scanned QR code is invalid, unrecognized, or already linked to another account, THEN THE Lab_Integration SHALL reject the link, leave any existing account-to-sample association unchanged, and display an error indicating the reason for rejection.
8. IF results are not received within 72 hours of the expected publication or the ingested payload fails structural validation, THEN THE Lab_Integration SHALL retain the order, flag it as results-pending, and display an error indicating results are unavailable.

### Requirement 9: Wearable and Health Platform Sensor Support

**User Story:** As Priya, I want the app to sync data from my wearables, so that I can track cortisol-proxy signals continuously.

#### Acceptance Criteria

1. WHERE the user connects Apple HealthKit or Google Health Connect, THE Wearable_Integration SHALL import all data categories that the user has explicitly authorized from the connected platform and complete the initial import within 60 seconds of authorization being granted.
2. IF the user denies or has not granted authorization for a requested data category, THEN THE Wearable_Integration SHALL exclude that category from import, retain all previously imported data, and present a notification indicating which categories are unavailable due to missing authorization.
3. WHERE the user connects an electrochemical sweat or interstitial-fluid patch, THE Wearable_Integration SHALL import cortisol measurements from the patch, each tagged with a measurement timestamp and the source patch identifier.
4. IF an imported cortisol measurement falls outside the range 0.01 to 100.00 (in the patch-reported unit) or is missing a measurement timestamp, THEN THE Wearable_Integration SHALL reject that measurement, exclude it from cortisol-proxy calculations, and record it as an invalid reading without discarding valid measurements from the same import.
5. WHERE the user connects a WHOOP, Oura, or Garmin device, THE Wearable_Integration SHALL import the device metrics as cortisol-proxy inputs, each tagged with the source device type and a capture timestamp.
6. WHILE a wearable connection is active, THE Wearable_Integration SHALL synchronize data in the background at an interval not exceeding 15 minutes.
7. IF a background synchronization attempt fails due to network unavailability or an unreachable platform or device, THEN THE Wearable_Integration SHALL retain the last successfully synchronized data, retry synchronization up to 3 times using intervals of 1, 5, and 15 minutes, and after the final failed attempt present a notification indicating that synchronization is unavailable.
8. IF a connected platform or device revokes or invalidates the app's authorization, THEN THE Wearable_Integration SHALL stop synchronization for that source, mark the connection as inactive, retain previously imported data, and present a notification indicating that reauthorization is required.

### Requirement 10: Symptom-Proxy Cortisol Estimation

**User Story:** As Jennifer, I want to estimate my stress burden through questionnaires, so that I can track stress without a lab test.

#### Acceptance Criteria

1. WHEN the user selects and completes all items of a validated questionnaire (PSS-10, GAD-7, or PSQI), THE Questionnaire_Engine SHALL compute the corresponding total score within its defined valid range (PSS-10: 0 to 40, GAD-7: 0 to 21, PSQI: 0 to 21).
2. IF the user submits a questionnaire with one or more unanswered items, THEN THE Questionnaire_Engine SHALL reject the submission, retain all previously entered answers, and display a message indicating which items remain incomplete.
3. WHEN a questionnaire total score is computed, THE Questionnaire_Engine SHALL map the score to exactly one cortisol burden tier (Low, Moderate, Elevated, or High) using the fixed threshold bands defined for that questionnaire, such that a given score always maps to the same tier.
4. WHEN a cortisol burden tier is presented, THE Questionnaire_Engine SHALL display, adjacent to the result and before any tier value, non-clinical framing text stating that the result is a wellness estimate and not a medical diagnosis.
5. WHEN 30 calendar days have elapsed since the user's last completed proxy questionnaire, THE Questionnaire_Engine SHALL prompt the user to complete the proxy questionnaire.
6. IF the user has never completed a proxy questionnaire, THEN THE Questionnaire_Engine SHALL prompt the user to complete the proxy questionnaire upon first access to the stress-tracking feature.

### Requirement 11: Diurnal Pattern Tracking

**User Story:** As Dr. Robert's patient, I want to track my cortisol daily rhythm, so that I can see deviations from a healthy pattern.

#### Acceptance Criteria

1. WHEN the user performs a CAR measurement, THE Diurnal_Tracker SHALL require a first sample taken within 30 minutes (tolerance ±5 minutes) of the user-recorded wake time and a second sample taken 30 minutes (tolerance ±5 minutes) after the first sample.
2. IF a CAR sample is recorded outside its required time window (first sample later than 35 minutes after wake time, or second sample not between 25 and 35 minutes after the first sample), THEN THE Diurnal_Tracker SHALL reject the sample, retain any previously accepted samples, and display an error message indicating that the sample was taken outside the allowed time window.
3. IF a CAR measurement contains fewer than the two required valid samples, THEN THE Diurnal_Tracker SHALL withhold CAR pattern evaluation and display a message indicating that the measurement is incomplete.
4. WHEN complete diurnal data is displayed, THE Diurnal_Tracker SHALL overlay the user's measured cortisol curve against an age-matched and sex-matched healthy reference curve on the same time axis.
5. IF the measured CAR shows a percentage increase from the waking sample to the +30-minute sample of less than 50 percent, THEN THE Diurnal_Tracker SHALL classify the pattern as a flattened CAR and raise a deviation alert that identifies the flattened CAR as the cause.
6. IF the measured evening cortisol sample exceeds the upper bound of the age-matched reference range, THEN THE Diurnal_Tracker SHALL raise a deviation alert that identifies elevated evening cortisol as the cause.

### Requirement 12: Cortisol Trend Visualization and Annotation

**User Story:** As Priya, I want to visualize my cortisol trends alongside other metrics, so that I can spot relationships between stress and my lifestyle.

#### Acceptance Criteria

1. WHEN the user selects a 7-day, 30-day, or 90-day range, THE Cortisol_Module SHALL render a cortisol trend chart within 3 seconds, displaying all cortisol readings within the selected range plus upper and lower reference bands.
2. IF the user selects a range for which no cortisol readings exist, THEN THE Cortisol_Module SHALL display an empty-state message indicating that no cortisol data is available for the selected range, and SHALL retain the currently selected range.
3. WHEN the user records a life event whose date falls within the selected range, THE Cortisol_Module SHALL annotate the trend chart with a marker positioned at the corresponding date.
4. IF the user records a life event whose date falls outside the selected range, THEN THE Cortisol_Module SHALL omit the annotation from the current chart without raising an error.
5. WHERE the user selects an overlay mode, THE Cortisol_Module SHALL display cortisol readings alongside exactly one of calories, sleep, or heart-rate variability on the same chart using a shared time axis for the selected range.
6. IF the user selects an overlay mode for which no readings exist within the selected range, THEN THE Cortisol_Module SHALL render the cortisol trend chart alone and display an indication that no overlay data is available for the selected metric and range.

### Requirement 13: Actionable Cortisol Guidance

**User Story:** As Jennifer, I want evidence-based guidance based on my stress data, so that I know what actions to consider.

#### Acceptance Criteria

1. WHEN the user's most recent cortisol reading is classified outside the normal reference range, THE Guidance_Engine SHALL present between 1 and 5 evidence-based recommendation cards drawn from clinically approved templates within 3 seconds of the classification being available.
2. IF the user's cortisol remains above the referral threshold for 3 or more consecutive weeks, THEN THE Guidance_Engine SHALL present a professional referral recommendation card displayed above all other recommendation cards.
3. THE Guidance_Engine SHALL present only recommendation content whose approval status is marked as approved by the clinical advisory board, and SHALL exclude any content in a draft, pending, or revoked approval state.
4. IF fewer than 7 days of cortisol readings are available, THEN THE Guidance_Engine SHALL withhold recommendation cards and SHALL present a message indicating that more readings are required before guidance can be generated, while retaining the collected readings.
5. IF no clinically approved recommendation template matches the user's cortisol classification, THEN THE Guidance_Engine SHALL present a message indicating that no guidance is currently available and SHALL NOT display uncategorized or unapproved content.

### Requirement 14: Lab Result Import and Doctor Sharing

**User Story:** As Dr. Robert's patient, I want to import external lab results and share reports with my physician, so that my care team has complete information.

#### Acceptance Criteria

1. WHEN the user uploads a lab result PDF of no more than 20 MB, THE Cortisol_Module SHALL extract the result values using OCR within 30 seconds.
2. IF the uploaded file exceeds 20 MB or is not in PDF format, THEN THE Cortisol_Module SHALL reject the upload, retain any previously imported results unchanged, and display an error message indicating the size or format constraint that was violated.
3. IF OCR extraction fails or produces no recognizable result values within 30 seconds, THEN THE Cortisol_Module SHALL discard the partial extraction, retain any previously imported results unchanged, and display an error message indicating that the lab result could not be read.
4. WHERE the user connects Epic MyChart, THE Cortisol_Module SHALL import lab results via FHIR R4 within 60 seconds.
5. IF the Epic MyChart connection fails or the FHIR R4 import does not complete within 60 seconds, THEN THE Cortisol_Module SHALL retain any previously imported results unchanged and display an error message indicating that the import was unsuccessful.
6. WHEN the user chooses to share results, THE Cortisol_Module SHALL generate a physician-ready PDF report from a single user action within 15 seconds.
7. IF PDF report generation fails or does not complete within 15 seconds, THEN THE Cortisol_Module SHALL not produce a partial report and SHALL display an error message indicating that the report could not be generated.

### Requirement 15: Cross-Modal Correlation and Insights

**User Story:** As Priya, I want the app to correlate my food intake with my cortisol levels, so that I can discover how eating affects my stress and vice versa.

#### Acceptance Criteria

1. WHEN at least one food entry and at least one cortisol measurement exist for the same day, THE Correlation_Engine SHALL align food entries and cortisol measurements whose timestamps fall within a window of plus or minus 180 minutes of each other.
2. IF a food entry has no cortisol measurement within the plus or minus 180-minute alignment window, THEN THE Correlation_Engine SHALL exclude that entry from correlation analysis without raising an error.
3. WHEN at least 20 aligned food-cortisol pairs exist within a rolling 30-day window and a relationship shows an absolute correlation coefficient of at least 0.5 with a p-value below 0.05, THE Correlation_Engine SHALL classify the relationship as significant and generate a smart alert describing the detected relationship.
4. IF fewer than 20 aligned food-cortisol pairs exist within the rolling 30-day window, THEN THE Correlation_Engine SHALL withhold significance analysis and SHALL present an indication that more data is required.
5. WHEN a same-direction significant relationship is detected on at least 3 separate days within a rolling 30-day window, THE Correlation_Engine SHALL surface the recurring pattern to the user.
6. THE Correlation_Engine SHALL generate an automated weekly digest and deliver it every Sunday at 08:00 in the user's local time.
7. IF weekly digest delivery fails, THEN THE Correlation_Engine SHALL retry delivery up to 3 times at 30-minute intervals and, after the final failed attempt, retain the digest for in-app viewing.
8. WHEN the user reaches the 30-day, 90-day, or 180-day usage milestone, THE Personalization_Model SHALL incorporate the accumulated data and rank surfaced insights by descending correlation strength.

### Requirement 16: User Onboarding and Profile Setup

**User Story:** As a new user, I want a guided setup that adapts to my goals, so that the app is configured for my needs from the start.

#### Acceptance Criteria

1. WHEN a new user starts onboarding, THE Account_Module SHALL present a 5-step onboarding flow collecting, in order: (1) health goals, (2) dietary restrictions and preferences, (3) connected devices, (4) cortisol testing intent, and (5) daily routine including wake time and meal patterns.
2. WHILE a user is on any step from 2 through 5, THE Account_Module SHALL allow the user to navigate to the previous step without losing responses already entered in the current or prior steps.
3. WHERE a user's health-goal selections in step 1 determine subsequent step content, THE Account_Module SHALL display in steps 2 through 5 only the input fields relevant to the selected health goals.
4. WHEN a user submits a step, THE Account_Module SHALL validate that all required fields for that step are provided and that wake time is a valid time value (00:00–23:59) before advancing to the next step.
5. IF a user attempts to advance a step with a missing required field or an invalid value, THEN THE Account_Module SHALL block advancement, retain the entered responses, and display an error message indicating which field is invalid.
6. WHEN all 5 steps are completed, THE Account_Module SHALL create a user profile from the collected onboarding responses and confirm completion to the user.
7. IF a user exits before completing all 5 steps, THEN THE Account_Module SHALL persist the responses entered so far and resume onboarding at the first incomplete step on the next session.
8. IF profile creation fails after step 5 completion, THEN THE Account_Module SHALL retain all collected responses, notify the user that setup could not be saved, and allow the user to retry without re-entering data.

### Requirement 17: Privacy-First Data Storage and Consent

**User Story:** As Jennifer, I want my health data kept private by default, so that I control what leaves my device.

#### Acceptance Criteria

1. THE Account_Module SHALL store all user health data in the local Data_Vault, and SHALL NOT transmit any health data category outside the local device unless the user has recorded explicit opt-in consent for that category.
2. WHERE the user opts in to cloud sync, THE Account_Module SHALL synchronize only the specific data categories for which the user has recorded an explicitly enabled opt-in, and SHALL retain all non-enabled categories exclusively in the local Data_Vault.
3. WHEN the user enables a granular sync opt-in setting, THE Account_Module SHALL record the updated consent state and apply it to all synchronization operations initiated after the change is saved.
4. WHEN the user disables a previously enabled granular sync opt-in setting, THE Account_Module SHALL stop synchronizing that data category within 5 seconds of the change being saved and SHALL retain the local copy in the Data_Vault.
5. IF a synchronization operation fails for an enabled data category, THEN THE Account_Module SHALL retain the affected data in the local Data_Vault, retry synchronization up to 3 times, and present a notification indicating the sync failure and the affected category.
6. IF a synchronization is attempted for a data category that has no recorded opt-in consent, THEN THE Account_Module SHALL block the transmission and present a notification indicating that consent is required for that category.

### Requirement 18: Biometric Authentication

**User Story:** As Marcus, I want to unlock the app with biometrics, so that my health data is protected and access is fast.

#### Acceptance Criteria

1. WHERE biometric authentication is enabled, WHEN the user opens the app or resumes it after the app has been backgrounded for 60 seconds or longer, THE Account_Module SHALL prompt for biometric authentication using Face ID, Touch ID, or Android Biometric before displaying any health data.
2. WHEN biometric authentication succeeds, THE Account_Module SHALL grant access to health data within 2 seconds of the successful biometric match.
3. IF biometric authentication fails a single attempt, THEN THE Account_Module SHALL keep health data hidden, display an indication that the biometric match was not recognized, and allow the user to retry.
4. IF biometric authentication fails 3 consecutive attempts, THEN THE Account_Module SHALL deny biometric access and present a fallback authentication method (passcode or password) to unlock health data.
5. IF the device has no biometric hardware enrolled or biometric authentication is unavailable at the operating system level, THEN THE Account_Module SHALL present the fallback authentication method and display an indication that biometrics are unavailable.
6. WHEN the user cancels the biometric prompt, THE Account_Module SHALL keep health data hidden and present the fallback authentication method.

### Requirement 19: Family Accounts

**User Story:** As Jennifer, I want to manage health profiles for my family, so that I can support my household from one account.

#### Acceptance Criteria

1. WHERE the family account feature is enabled, THE Account_Module SHALL support up to 5 isolated member profiles under one family account.
2. IF a family admin attempts to add a member profile when the family account already contains 5 member profiles, THEN THE Account_Module SHALL reject the request, display an error indicating the maximum of 5 member profiles has been reached, and retain the existing profiles unchanged.
3. THE Account_Module SHALL keep each family member profile's health data isolated such that health data belonging to one member profile is not readable or modifiable from any other member profile within the family account.
4. IF a family member profile without the family admin role attempts to read or modify another member profile's health data, THEN THE Account_Module SHALL deny the request, display an error indicating insufficient permissions, and leave the target profile's health data unchanged.
5. WHERE a user holds the family admin role, WHEN the admin adds, views, edits, or removes a member profile, THE Account_Module SHALL apply the requested change to the specified member profile within the family account.
6. IF a user without the family admin role attempts to add, edit, or remove a member profile, THEN THE Account_Module SHALL deny the operation, display an error indicating insufficient permissions, and leave the affected member profiles unchanged.

### Requirement 20: Data Export and Account Deletion

**User Story:** As a privacy-conscious user, I want to export or delete my data, so that I retain control over my personal information in line with data-protection regulations.

#### Acceptance Criteria

1. WHEN an authenticated user requests a data export, THE Account_Module SHALL generate a file containing all of the user's personal data in both JSON and CSV formats in accordance with GDPR Article 20, and SHALL make the export available to the user within 24 hours of the request.
2. IF a data export request is submitted by an unauthenticated or unverified user, THEN THE Account_Module SHALL reject the request, retain no export file, and return a response indicating that identity verification is required.
3. IF the data export generation fails, THEN THE Account_Module SHALL not produce a partial export file, SHALL preserve the user's data unchanged, and SHALL return a response indicating that the export could not be completed.
4. WHEN an authenticated user requests account deletion, THE Account_Module SHALL require explicit confirmation from the user before initiating deletion.
5. WHEN account deletion is confirmed, THE Account_Module SHALL delete the user's account and associated personal data within 30 days in accordance with GDPR Article 17, excluding data that is subject to a legal retention obligation.
6. WHERE data is retained under a legal retention obligation after account deletion, THE Account_Module SHALL restrict that data to the retention purpose only and SHALL return a response indicating which categories of data were retained and the basis for retention.
7. IF the account deletion process fails to complete within 30 days of confirmation, THEN THE Account_Module SHALL preserve the account in its pre-deletion state and SHALL notify the user that the deletion did not complete.

### Requirement 21: Performance

**User Story:** As Marcus, I want the app to respond quickly, so that logging and reviewing data never slows me down.

#### Acceptance Criteria

1. WHEN a food image is analyzed over a 4G connection with measured downlink throughput of at least 5 Mbps and round-trip latency of 100 ms or less, THE System SHALL return the analysis result within 3 seconds for at least the 95th percentile of analysis requests, measured from image submission to display of the result.
2. WHEN a food image is analyzed over a WiFi connection with measured downlink throughput of at least 20 Mbps and round-trip latency of 50 ms or less, THE System SHALL return the analysis result within 1.5 seconds for at least the 95th percentile of analysis requests, measured from image submission to display of the result.
3. WHEN the user opens a dashboard for which all required data is present in the local cache, THE System SHALL render the fully populated dashboard within 1 second for at least the 95th percentile of dashboard opens, measured from the open action to completion of visible rendering.
4. WHEN the user opens a dashboard that requires retrieval of fresh data from the server, THE System SHALL render the fully populated dashboard within 2 seconds for at least the 95th percentile of dashboard opens, measured from the open action to completion of visible rendering.
5. WHEN the user performs a cold launch to the camera, where a cold launch is an app start with no prior process resident in memory, THE System SHALL display the ready-to-capture camera view within 2 seconds for at least the 95th percentile of cold launches, measured from app icon activation to camera view readiness.
6. IF a food image analysis does not return a result within 10 seconds, THEN THE System SHALL cancel the analysis, retain any unsaved input, and present an error indication that the analysis timed out with an option to retry.

### Requirement 22: Calorie Estimation Accuracy

**User Story:** As Priya, I want dependable calorie accuracy, so that I can trust the numbers for my fitness goals.

#### Acceptance Criteria

1. WHEN calorie estimates are produced from single-angle images at launch and evaluated against the dietitian-verified validation dataset containing at least 500 labeled food items, THE Food_Estimation_Module SHALL achieve a Mean Absolute Percentage Error below 15 percent, where the dietitian-verified calorie values serve as ground truth.
2. WHEN calorie estimates are produced from multi-angle captures and evaluated against the dietitian-verified validation dataset containing at least 500 labeled food items, THE Food_Estimation_Module SHALL achieve a Mean Absolute Percentage Error below 5 percent, where the dietitian-verified calorie values serve as ground truth.
3. WHEN an accuracy evaluation run completes against the dietitian-verified validation dataset, THE Food_Estimation_Module SHALL record the computed Mean Absolute Percentage Error, the capture mode (single-angle or multi-angle), and the count of dataset items evaluated.
4. IF a completed accuracy evaluation run yields a Mean Absolute Percentage Error at or above the applicable threshold (15 percent for single-angle, 5 percent for multi-angle), THEN THE Food_Estimation_Module SHALL flag the evaluation run as failed and produce an indication identifying the capture mode and the measured error value, while retaining the recorded evaluation results.
5. WHEN a single calorie estimate is returned to the user, THE Food_Estimation_Module SHALL include the estimated calorie value as a numeric quantity greater than or equal to 0 kilocalories.

### Requirement 23: Scalability

**User Story:** As the product operator, I want the system to handle large-scale usage, so that the service stays responsive at peak demand.

#### Acceptance Criteria

1. WHILE serving up to 10,000,000 concurrent active users, THE System SHALL sustain a request error rate of no more than 0.1 percent and a 95th-percentile end-to-end response time of no more than 2 seconds, measured continuously over any 60-minute peak window.
2. WHILE operating at peak load of 10,000 images per second, THE System SHALL complete processing of each image within 5 seconds at the 95th percentile and maintain a processing failure rate of no more than 0.1 percent, measured continuously over any 60-minute peak window.
3. IF concurrent active users exceed 10,000,000 or the image ingestion rate exceeds 10,000 images per second, THEN THE System SHALL reject or queue the excess load, return a response to the caller indicating that capacity has been exceeded, and preserve the availability and correctness of in-progress requests already accepted.
4. WHEN sustained load rises above 70 percent of the 10,000,000 concurrent-user or 10,000-images-per-second capacity, THE System SHALL provision additional processing capacity within 300 seconds without dropping accepted requests.

### Requirement 24: Availability

**User Story:** As a user, I want the service to be reliably available, so that I can log and review data whenever I need to.

#### Acceptance Criteria

1. THE System SHALL maintain at least 99.9 percent uptime for general services, measured over each calendar month as the ratio of successful health-check responses to total health-check requests, excluding pre-announced scheduled maintenance windows.
2. THE Lab_Integration SHALL maintain at least 99.95 percent uptime for lab result ingestion, measured over each calendar month as the ratio of successful ingestion health-check responses to total ingestion health-check requests, excluding pre-announced scheduled maintenance windows.
3. WHEN a monitored service fails to return a successful health-check response for 3 consecutive checks performed at 60-second intervals, THE System SHALL record the service as unavailable and record the start timestamp of the downtime interval.
4. WHEN a service previously recorded as unavailable returns 3 consecutive successful health-check responses at 60-second intervals, THE System SHALL record the service as available and record the end timestamp of the downtime interval.
5. IF the accumulated downtime for general services within a calendar month exceeds 43 minutes, or the accumulated downtime for lab result ingestion within a calendar month exceeds 21 minutes, THEN THE System SHALL raise an availability-breach alert to operators indicating the affected service and the total downtime, and SHALL retain all recorded downtime intervals for the month.

### Requirement 25: Security

**User Story:** As a user, I want my health data protected with strong security, so that my sensitive information stays confidential.

#### Acceptance Criteria

1. THE System SHALL encrypt stored health data at rest using AES-256 with per-user encryption keys, where the encryption keys are stored separately from the encrypted data.
2. WHEN health data is transmitted over any network connection, THE System SHALL use TLS 1.3 with certificate pinning.
3. IF a network connection cannot be established using TLS 1.3 or certificate pinning validation fails, THEN THE System SHALL reject the connection, transmit no health data, and record the failed connection attempt.
4. THE System SHALL operate under controls that satisfy SOC 2 Type II requirements.
5. THE System SHALL handle PHI in accordance with HIPAA requirements and comply with GDPR and CCPA.
6. WHEN a user or system component reads, creates, modifies, or deletes health data, THE System SHALL record an audit log entry containing the actor identity, the action type, the affected data record identifier, and a timestamp, and SHALL retain each entry for at least 6 years.
7. IF a request to access health data lacks valid authentication or authorization, THEN THE System SHALL deny the request, return an error indicating access is not permitted, and record the denied attempt in the audit log.

### Requirement 26: Accessibility

**User Story:** As a user who relies on assistive technology, I want the app to be fully accessible, so that I can log and review my health data independently.

#### Acceptance Criteria

1. THE System SHALL conform to WCAG 2.1 Level AA, including a minimum text contrast ratio of 4.5:1 for normal text and 3:1 for large text (18pt or 14pt bold and above), and a minimum interactive touch target size of 44 by 44 CSS pixels.
2. WHEN a screen reader (VoiceOver or TalkBack) is active, THE System SHALL expose an accessible name, role, and current state for every interactive element and every informational image.
3. WHEN the value or state of a user-interface element changes as a result of a user action, THE System SHALL announce the change through the active screen reader within 1 second.
4. WHILE voice-guided food logging is active, THE System SHALL provide an audible prompt for each required data field and accept a spoken response for that field.
5. IF a spoken response during voice-guided food logging is not recognized or is invalid, THEN THE System SHALL emit an audible error indication describing the expected input and SHALL re-prompt for the same field, allowing a maximum of 3 attempts per field before offering an alternative input method.
6. WHEN the user navigates using a keyboard or switch device, THE System SHALL present a visible focus indicator on the focused element and SHALL move focus in a logical reading order.

### Requirement 27: Offline Mode

**User Story:** As Marcus, I want core features to work without connectivity, so that I can log meals anywhere.

#### Acceptance Criteria

1. WHILE the device is offline, THE System SHALL allow photo capture, perform on-device inference within 10 seconds per photo, and store the resulting record in the local Data_Vault.
2. IF on-device inference fails to produce a result within 10 seconds, THEN THE System SHALL store the captured photo with an "inference pending" status in the local Data_Vault and display an indication that analysis will complete later.
3. IF storing a record in the local Data_Vault fails because available local storage is below the 50 MB minimum required for a new record, THEN THE System SHALL reject the capture, retain any previously stored records unchanged, and display an error indicating insufficient local storage.
4. WHEN network connectivity is restored, THE System SHALL synchronize all locally stored unsynced records according to the user's sync settings within 60 seconds of restoration.
5. IF synchronization of a record fails after 3 retry attempts, THEN THE System SHALL retain the record in the local Data_Vault marked as unsynced, preserve its local data unchanged, and display an indication that the record has not yet synced.
6. IF a synchronization conflict is detected between a locally stored record and a server-side record for the same item, THEN THE System SHALL retain both versions, apply the conflict resolution defined in the user's sync settings, and display an indication that a conflict occurred.

### Requirement 28: Resource Efficiency

**User Story:** As a mobile user, I want the app to be light on battery and storage, so that it does not degrade my device experience.

#### Acceptance Criteria

1. WHEN the user completes 10 consecutive meal logs on the benchmark device (iPhone 15 Pro), where each meal log comprises a food photo capture, on-device inference, and save, and the measurement starts from a fully charged (100 percent) battery with no other foreground applications running, THE System SHALL consume less than 5 percent of device battery over the 10-log session.
2. THE System SHALL package the on-device inference model as a bundled artifact not exceeding 80 megabytes.
3. THE System SHALL keep the total application install size on the benchmark device (iPhone 15 Pro), measured after installation completes, at 150 megabytes or less.

### Requirement 29: Regulatory Framing and Wellness Disclaimers

**User Story:** As a user, I want clear wellness framing, so that I understand the app provides general-wellness guidance rather than medical diagnosis.

#### Acceptance Criteria

1. THE System SHALL present all health insights as general-wellness information and SHALL exclude any diagnostic claim, medical condition name, or treatment recommendation in v1.0.
2. WHEN any health insight is displayed, THE System SHALL show a wellness disclaimer, visible without scrolling and located within the same view as the insight, stating that the information is general-wellness guidance and not a medical diagnosis.
3. THE Guidance_Engine SHALL present only insight templates that carry a recorded clinical advisory board approval status of "approved".
4. IF an insight template lacks a recorded clinical advisory board approval status of "approved", THEN THE Guidance_Engine SHALL suppress that insight, exclude it from display, and retain the underlying reading data unchanged.
5. IF the wellness disclaimer cannot be rendered with an insight, THEN THE System SHALL withhold that insight from display and show an indication that the insight is unavailable.

### Requirement 30: Compliance Controls for Health Data and Partners

**User Story:** As a compliance officer, I want the system to enforce regulatory controls, so that the product meets its legal and contractual obligations.

#### Acceptance Criteria

1. WHEN a laboratory partner is onboarded, THE Lab_Integration SHALL verify that the partner holds a CLIA certification with an expiration date later than the current date before enabling result ingestion for that partner.
2. IF a laboratory partner's CLIA certification is absent, expired, or cannot be verified, THEN THE Lab_Integration SHALL keep result ingestion disabled for that partner and record a compliance indicator identifying the failed verification.
3. IF a partner that handles PHI does not have an executed Business Associate Agreement on record, THEN THE System SHALL block all PHI exchange with that partner and record a compliance indicator identifying the missing agreement.
4. WHEN the user first submits health data, THE Account_Module SHALL require the user to provide an explicit affirmative health-data consent action before the health data is persisted.
5. IF the user declines or does not provide explicit health-data consent, THEN THE Account_Module SHALL reject the health data submission, retain no submitted health data, and present an indication that consent is required.
6. WHERE the user's country of residence is a European Union member state, THE System SHALL store and retain that user's data exclusively in data center regions located within the European Union.
7. IF a user identified as a European Union resident has data stored outside a European Union region, THEN THE System SHALL block further processing of that user's data and record a compliance indicator identifying the residency violation.
