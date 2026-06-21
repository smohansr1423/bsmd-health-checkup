-- CreateEnum
CREATE TYPE "DeviceDeviceType" AS ENUM ('BLOOD_PRESSURE_MONITOR', 'GLUCOMETER', 'PULSE_OXIMETER', 'THERMOMETER', 'WEIGHT_SCALE');

-- CreateEnum
CREATE TYPE "DeviceReadingType" AS ENUM ('BLOOD_PRESSURE', 'BLOOD_GLUCOSE', 'HEART_RATE', 'SPO2', 'TEMPERATURE', 'WEIGHT');

-- CreateEnum
CREATE TYPE "ConnectionProtocol" AS ENUM ('BLUETOOTH', 'WIFI');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertDirection" AS ENUM ('ABOVE', 'BELOW');

-- CreateTable
CREATE TABLE "device_registries" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "deviceType" "DeviceDeviceType" NOT NULL,
    "seniorId" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectionProtocol" "ConnectionProtocol" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncTimestamp" TIMESTAMP(3),

    CONSTRAINT "device_registries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_readings" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "dailyRecordId" TEXT NOT NULL,
    "readingType" "DeviceReadingType" NOT NULL,
    "measuredValue" DECIMAL(10,2) NOT NULL,
    "secondaryValue" DECIMAL(10,2),
    "unit" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_health_records" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "latestReadings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_health_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_alerts" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "readingType" "DeviceReadingType" NOT NULL,
    "measuredValue" DECIMAL(10,2) NOT NULL,
    "thresholdBreached" DECIMAL(10,2) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "direction" "AlertDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normal_ranges" (
    "id" TEXT NOT NULL,
    "readingType" "DeviceReadingType" NOT NULL,
    "ageGroup" "AgeGroup" NOT NULL,
    "criticalLow" DECIMAL(10,2) NOT NULL,
    "borderlineLow" DECIMAL(10,2) NOT NULL,
    "normalLow" DECIMAL(10,2) NOT NULL,
    "normalHigh" DECIMAL(10,2) NOT NULL,
    "borderlineHigh" DECIMAL(10,2) NOT NULL,
    "criticalHigh" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "normal_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_registries_serialNumber_key" ON "device_registries"("serialNumber");

-- CreateIndex
CREATE INDEX "device_registries_seniorId_idx" ON "device_registries"("seniorId");

-- CreateIndex
CREATE INDEX "health_readings_deviceId_idx" ON "health_readings"("deviceId");

-- CreateIndex
CREATE INDEX "health_readings_seniorId_idx" ON "health_readings"("seniorId");

-- CreateIndex
CREATE INDEX "health_readings_dailyRecordId_idx" ON "health_readings"("dailyRecordId");

-- CreateIndex
CREATE INDEX "health_readings_readingType_idx" ON "health_readings"("readingType");

-- CreateIndex
CREATE INDEX "health_readings_timestamp_idx" ON "health_readings"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "daily_health_records_seniorId_recordDate_key" ON "daily_health_records"("seniorId", "recordDate");

-- CreateIndex
CREATE INDEX "daily_health_records_seniorId_idx" ON "daily_health_records"("seniorId");

-- CreateIndex
CREATE INDEX "daily_health_records_recordDate_idx" ON "daily_health_records"("recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "reading_alerts_readingId_key" ON "reading_alerts"("readingId");

-- CreateIndex
CREATE INDEX "reading_alerts_seniorId_idx" ON "reading_alerts"("seniorId");

-- CreateIndex
CREATE INDEX "reading_alerts_readingType_idx" ON "reading_alerts"("readingType");

-- CreateIndex
CREATE INDEX "reading_alerts_severity_idx" ON "reading_alerts"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "normal_ranges_readingType_ageGroup_key" ON "normal_ranges"("readingType", "ageGroup");

-- AddForeignKey
ALTER TABLE "device_registries" ADD CONSTRAINT "device_registries_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "health_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_readings" ADD CONSTRAINT "health_readings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_registries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_readings" ADD CONSTRAINT "health_readings_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "health_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_readings" ADD CONSTRAINT "health_readings_dailyRecordId_fkey" FOREIGN KEY ("dailyRecordId") REFERENCES "daily_health_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_health_records" ADD CONSTRAINT "daily_health_records_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "health_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_alerts" ADD CONSTRAINT "reading_alerts_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "health_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_alerts" ADD CONSTRAINT "reading_alerts_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "health_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
