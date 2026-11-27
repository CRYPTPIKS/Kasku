-- CreateEnum
CREATE TYPE "InvestmentValuationMode" AS ENUM ('units', 'value');

-- AlterTable
ALTER TABLE "InvestmentAsset" ADD COLUMN     "valuationMode" "InvestmentValuationMode" NOT NULL DEFAULT 'units';
